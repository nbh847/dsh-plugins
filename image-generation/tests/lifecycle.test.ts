/** Plugin lifecycle: registration shape, missing-key behavior, and disposal safety. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

/** Capture the definition registered on a stubbed host context. */
function registerOn(env: NodeJS.ProcessEnv): ToolDefinition {
  const registered: ToolDefinition[] = []
  const ctx = { tools: { register: (definition: ToolDefinition): (() => void) => {
    registered.push(definition)
    return () => undefined
  } } } as unknown as Context
  apply(ctx)
  expect(registered).toHaveLength(1)
  void env
  return registered[0]!
}

describe('plugin lifecycle', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('registers one generate_image tool with output schema and conservative timeout', () => {
    const definition = registerOn({})
    expect(definition.name).toBe('generate_image')
    expect(definition.timeoutMs).toBe(300_000)
    expect(definition.output.schema).toBeDefined()
    expect(typeof definition.output.render).toBe('function')
    const parameters = definition.parameters as { properties: Record<string, { type: string }> ; required: string[] }
    expect(parameters.required).toEqual(['prompt'])
    expect(parameters.properties.prompt?.type).toBe('string')
    expect(parameters.properties.size?.type).toBe('string')
    expect(parameters.properties.watermark?.type).toBe('boolean')
  })

  it('reports a configuration error without any network request when the key is missing', async () => {
    vi.stubEnv('SENSENOVA_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const definition = registerOn(process.env)
    const exec = { signal: new AbortController().signal } as Parameters<ToolDefinition['execute']>[1]
    await expect(definition.execute({ prompt: 'a seal pup' }, exec))
      .rejects.toThrow(/SENSENOVA_API_KEY is not set/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('output render keeps the returned value as one text block', () => {
    const definition = registerOn({})
    const value = '{"imageUrl":"https://example.com/x.png"}'
    expect(definition.output.render({}, value)).toEqual([{ type: 'text', text: value }])
  })
})
