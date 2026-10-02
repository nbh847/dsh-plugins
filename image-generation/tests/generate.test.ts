/** Synchronous generation flow: request contract, success mapping, and failure paths. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'
import { SensenovaError, generateImage } from '../src/sensenova.ts'

const API_KEY = 'test-key-not-a-secret'
const BASE = { apiKey: API_KEY, baseUrl: 'https://token.sensenova.cn', model: 'sensenova-u1.5-lite' }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function successPayload() {
  return {
    created: 1788849614,
    data: [{ url: 'https://cdn.sensenova.dev/gen/abc.png' }],
    output_format: 'png',
    size: '1024x1024',
    usage: {
      input_tokens: 1540,
      input_tokens_details: { image_tokens: 0, text_tokens: 1540 },
      output_tokens: 4096,
      total_tokens: 5636,
      images_count: 1,
    },
  }
}

/** Register the real tool and return its registry-ready execute. */
function toolExecute(): { execute: ToolDefinition['execute'] } {
  const registered: ToolDefinition[] = []
  const ctx = { tools: { register: (definition: ToolDefinition): (() => void) => {
    registered.push(definition)
    return () => undefined
  } } } as unknown as Parameters<typeof apply>[0]
  apply(ctx)
  return { execute: registered[0]!.execute }
}

/** Client-level request with a fresh signal and a mocked fetch. */
async function clientCall(overrides: Partial<Parameters<typeof generateImage>[0]>): Promise<unknown> {
  return await generateImage({
    ...BASE,
    prompt: 'a seal pup',
    watermark: false,
    signal: new AbortController().signal,
    ...overrides,
  })
}

describe('generateImage request contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends exactly one POST with the official model, n=1, and url response format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, successPayload()))
    vi.stubGlobal('fetch', fetchMock)
    await clientCall({})
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://token.sensenova.cn/v1/images/generations')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`)
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      model: 'sensenova-u1.5-lite',
      prompt: 'a seal pup',
      n: 1,
      response_format: 'url',
      watermark: false,
    })
  })

  it('forwards size and watermark overrides without reinterpretation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, successPayload()))
    vi.stubGlobal('fetch', fetchMock)
    await clientCall({ size: '2048x2048', watermark: true })
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.size).toBe('2048x2048')
    expect(body.watermark).toBe(true)
  })

  it('maps the official payload to the flat result shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, successPayload())))
    const result = await clientCall({}) as Awaited<ReturnType<typeof generateImage>>
    expect(result.url).toBe('https://cdn.sensenova.dev/gen/abc.png')
    expect(result.created).toBe(1788849614)
    expect(result.size).toBe('1024x1024')
    expect(result.usage?.totalTokens).toBe(5636)
    expect(result.usage?.imagesCount).toBe(1)
  })
})

describe('generateImage failure paths', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('never retries: one call performs exactly one request even on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { error: { message: 'boom' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(clientCall({})).rejects.toThrow(SensenovaError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports authentication failures for 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: 'bad key' } })))
    await expect(clientCall({})).rejects.toThrow(/authentication failed.*bad key/s)
  })

  it('reports rate limiting for 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { error: { code: 'ARREAR', message: 'too many requests' } })))
    await expect(clientCall({})).rejects.toThrow(/rate limited.*ARREAR too many requests/s)
  })

  it('surfaces API error code and message for other non-2xx statuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })))
    await expect(clientCall({})).rejects.toThrow(/HTTP 500.*INTERNAL boom/s)
  })

  it('normalizes network failures without credentials in the message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND token.sensenova.cn')))
    const error = await clientCall({}).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SensenovaError)
    expect((error as Error).message).toContain('getaddrinfo ENOTFOUND')
    expect((error as Error).message).not.toContain(API_KEY)
  })

  it('rejects an empty data[] and a missing url as invalid responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { created: 1, data: [] })))
    await expect(clientCall({})).rejects.toThrow(/data\[\] is missing or empty/)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { created: 1, data: [{ b64_json: 'xx' }] })))
    await expect(clientCall({})).rejects.toThrow(/data\[0\]\.url is missing/)
  })

  it('rejects a non-JSON success body as an invalid response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })))
    await expect(clientCall({})).rejects.toThrow(/body is not JSON/)
  })

  it('propagates the caller abort during the request without wrapping it', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('This operation was aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      controller.abort()
      return Promise.reject(abortError)
    }))
    await expect(generateImage({ ...BASE, prompt: 'x', watermark: false, signal: controller.signal }))
      .rejects.toBe(abortError)
  })

  it('fails before dispatch when the signal is already aborted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    await expect(generateImage({ ...BASE, prompt: 'x', watermark: false, signal: controller.signal }))
      .rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('generate_image tool validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rejects an empty prompt through the registry-ready definition', async () => {
    vi.stubEnv('SENSENOVA_API_KEY', API_KEY)
    vi.stubGlobal('fetch', vi.fn())
    const { execute } = toolExecute()
    const exec = { signal: new AbortController().signal } as Parameters<ToolDefinition['execute']>[1]
    await expect(execute({ prompt: '' }, exec))
      .rejects.toThrow(/prompt/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('rejects size values outside the official constraints before any request', async () => {
    vi.stubEnv('SENSENOVA_API_KEY', API_KEY)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, successPayload()))
    vi.stubGlobal('fetch', fetchMock)
    const { execute } = toolExecute()
    const exec = { signal: new AbortController().signal } as Parameters<ToolDefinition['execute']>[1]
    await expect(execute({ prompt: 'a seal', size: '100x100' }, exec))
      .rejects.toThrow(/invalid size/)
    await expect(execute({ prompt: 'a seal', size: '1024x1023' }, exec))
      .rejects.toThrow(/invalid size/)
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(execute({ prompt: 'a seal', size: 'auto' }, exec)).resolves.toBeDefined()
  })

  it('returns the flattened result JSON on success', async () => {
    vi.stubEnv('SENSENOVA_API_KEY', API_KEY)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, successPayload())))
    const { execute } = toolExecute()
    const exec = { signal: new AbortController().signal } as Parameters<ToolDefinition['execute']>[1]
    const value = await execute({ prompt: 'a seal pup' }, exec)
    const parsed = JSON.parse(value as string) as { imageUrl: string; size?: string; usage?: { totalTokens?: number } }
    expect(parsed.imageUrl).toBe('https://cdn.sensenova.dev/gen/abc.png')
    expect(parsed.size).toBe('1024x1024')
    expect(parsed.usage?.totalTokens).toBe(5636)
  })
})
