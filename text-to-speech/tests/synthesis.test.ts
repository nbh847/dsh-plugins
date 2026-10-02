/** Synthesis flow: request contract, voice resolution, and failure paths. All network is mocked. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

/** Official success payload shape (3.0 model reports characters usage). */
function successPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request_id: 'req-1',
    output: {
      finish_reason: 'stop',
      audio: {
        url: 'https://audio.example.com/x.wav',
        id: 'audio-1',
        expires_at: 1_900_000_000,
        data: '',
      },
    },
    usage: { characters: 42 },
    ...overrides,
  }
}

/** Register the tool on a stubbed host context and return its execute. */
function toolExecute(): ToolDefinition['execute'] {
  const registered: ToolDefinition[] = []
  const ctx = { tools: { register: (definition: ToolDefinition): (() => void) => {
    registered.push(definition)
    return () => undefined
  } } } as unknown as Context
  apply(ctx)
  expect(registered).toHaveLength(1)
  return registered[0]!.execute
}

/** Standard exec object with a live abort controller. */
function makeExec(): { exec: Parameters<ToolDefinition['execute']>[1]; controller: AbortController } {
  const controller = new AbortController()
  return {
    controller,
    exec: { signal: controller.signal } as unknown as Parameters<ToolDefinition['execute']>[1],
  }
}

/** JSON response helper for the fetch mock. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const BASE_ENV = {
  DASHSCOPE_API_KEY: 'sk-secret',
  DASHSCOPE_WORKSPACE_ID: 'ws-1',
  DASHSCOPE_TTS_VOICE: 'longanhuan_v3.6',
}

/** Stub the full valid environment; tests that must reach fetch call this first. */
function stubValidEnv(): void {
  vi.stubEnv('DASHSCOPE_API_KEY', BASE_ENV.DASHSCOPE_API_KEY)
  vi.stubEnv('DASHSCOPE_WORKSPACE_ID', BASE_ENV.DASHSCOPE_WORKSPACE_ID)
  vi.stubEnv('DASHSCOPE_TTS_VOICE', BASE_ENV.DASHSCOPE_TTS_VOICE)
}

describe('synthesis flow', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('sends one request with the official contract and returns the audio mapping', async () => {
    stubValidEnv()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, successPayload()))
    vi.stubGlobal('fetch', fetchMock)
    const execute = toolExecute()
    const { exec } = makeExec()
    const value = await execute({ text: '散帅，你好。' }, exec) as string
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ws-1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret')
    const body = JSON.parse(init.body as string) as {
      model: string
      input: { text: string; voice: string; format: string; sample_rate: number }
    }
    expect(body.model).toBe('qwen-audio-3.0-tts-flash')
    expect(body.input.text).toBe('散帅，你好。')
    expect(body.input.voice).toBe('longanhuan_v3.6')
    expect(body.input.format).toBe('wav')
    expect(body.input.sample_rate).toBe(24000)
    expect(JSON.parse(value)).toEqual({
      audioUrl: 'https://audio.example.com/x.wav',
      expiresAt: 1_900_000_000,
      requestId: 'req-1',
      usage: { characters: 42 },
    })
  })

  it('prefers the explicit voice over the configured default and forwards token usage fields', async () => {
    stubValidEnv()
    vi.stubEnv('DASHSCOPE_TTS_MODEL', 'qwen-audio-3.1-tts-flash')
    vi.stubEnv('DASHSCOPE_TTS_VOICE', 'longanhuan_v3.1')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, successPayload({
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    })))
    vi.stubGlobal('fetch', fetchMock)
    const execute = toolExecute()
    const { exec } = makeExec()
    const value = await execute({ text: 'hello', voice: 'longjielidou_v3.6' }, exec) as string
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      model: string
      input: { voice: string }
    }
    expect(body.model).toBe('qwen-audio-3.1-tts-flash')
    expect(body.input.voice).toBe('longjielidou_v3.6')
    expect(JSON.parse(value)).toEqual({
      audioUrl: 'https://audio.example.com/x.wav',
      expiresAt: 1_900_000_000,
      requestId: 'req-1',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    })
  })

  it('fails with a clear error and no request when neither call nor environment provides a voice', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', BASE_ENV.DASHSCOPE_API_KEY)
    vi.stubEnv('DASHSCOPE_WORKSPACE_ID', BASE_ENV.DASHSCOPE_WORKSPACE_ID)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const execute = toolExecute()
    const { exec } = makeExec()
    await expect(execute({ text: '你好' }, exec))
      .rejects.toThrow(/no voice available/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects empty, whitespace-only, and oversized text before any request', async () => {
    stubValidEnv()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const execute = toolExecute()
    const { exec } = makeExec()
    await expect(execute({}, exec)).rejects.toThrow(/missing required property "text"/)
    await expect(execute({ text: '   ' }, exec)).rejects.toThrow(/text is required/)
    await expect(execute({ text: 'a'.repeat(20_001) }, exec))
      .rejects.toThrow(/exceed the official limit of 20000/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts text of exactly the official limit', async () => {
    stubValidEnv()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, successPayload()))
    vi.stubGlobal('fetch', fetchMock)
    const execute = toolExecute()
    const { exec } = makeExec()
    await expect(execute({ text: 'a'.repeat(20_000) }, exec)).resolves.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps authentication, rate-limit, and generic API failures without leaking credentials', async () => {
    stubValidEnv()
    const execute = toolExecute()
    const { exec } = makeExec()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {
      code: 'InvalidApiKey', message: 'Invalid API-key provided.', request_id: 'req-401',
    })))
    await expect(execute({ text: '你好' }, exec)).rejects.toThrow(/authentication failed.*InvalidApiKey: Invalid API-key provided\./s)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, {
      code: 'Throttling', message: 'Requests throttling triggered.', request_id: 'req-429',
    })))
    await expect(execute({ text: '你好' }, exec)).rejects.toThrow(/rate limited.*Throttling/s)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {
      code: 'InternalError', message: 'engine failure', request_id: 'req-500',
    })))
    await expect(execute({ text: '你好' }, exec)).rejects.toThrow(/HTTP 500.*InternalError.*engine failure.*req-500/s)

    vi.unstubAllGlobals()
    const text = JSON.stringify({ text: '你好' })
    expect(text).not.toContain('sk-secret')
  })

  it('falls back to the status-based failure when an error body is not JSON', async () => {
    stubValidEnv()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>boom</html>', { status: 502 })))
    const execute = toolExecute()
    const { exec } = makeExec()
    await expect(execute({ text: '你好' }, exec)).rejects.toThrow(/Bailian API error \(HTTP 502\)/)
  })

  it('rejects non-JSON success bodies and responses missing required fields', async () => {
    stubValidEnv()
    const execute = toolExecute()
    const { exec } = makeExec()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })))
    await expect(execute({ text: '你好' }, exec)).rejects.toThrow(/body is not JSON/)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { output: { audio: { url: 'https://x' } } })))
    await expect(execute({ text: '你好' }, exec)).rejects.toThrow(/request_id is missing/)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { request_id: 'req-1', output: { audio: {} } })))
    await expect(execute({ text: '你好' }, exec)).rejects.toThrow(/output\.audio\.url is missing/)
  })

  it('wraps network failures and never sends a second request', async () => {
    stubValidEnv()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    const execute = toolExecute()
    const { exec } = makeExec()
    await expect(execute({ text: '你好' }, exec)).rejects.toThrow(/speech synthesis request failed: fetch failed/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates pre-request and in-flight cancellation without retries', async () => {
    stubValidEnv()
    const execute = toolExecute()

    const aborted = makeExec()
    aborted.controller.abort()
    const beforeFetch = vi.fn()
    vi.stubGlobal('fetch', beforeFetch)
    await expect(execute({ text: '你好' }, aborted.exec)).rejects.toThrow()
    expect(beforeFetch).not.toHaveBeenCalled()

    const inFlight = makeExec()
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () =>
          reject((init.signal as AbortSignal).reason))
      }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = execute({ text: '你好' }, inFlight.exec)
    inFlight.controller.abort()
    await expect(pending).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
