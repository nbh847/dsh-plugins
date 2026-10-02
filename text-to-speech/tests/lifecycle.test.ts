/** Plugin lifecycle: registration shape, dispose safety, and missing-key behavior. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

/** Minimal fake host registry that tracks active tools and their disposers. */
function makeContext(): { ctx: Context; active: ToolDefinition[]; disposers: (() => void)[] } {
  const active: ToolDefinition[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    tools: {
      register: (definition: ToolDefinition): (() => void) => {
        active.push(definition)
        const disposer = () => {
          const index = active.indexOf(definition)
          if (index >= 0) active.splice(index, 1)
        }
        disposers.push(disposer)
        return disposer
      },
    },
  } as unknown as Context
  return { ctx, active, disposers }
}

/** Apply to a fresh context and assert exactly one tool was registered. */
function registerOnce(): { definition: ToolDefinition; dispose(): void } {
  const { ctx, active } = makeContext()
  apply(ctx)
  expect(active).toHaveLength(1)
  return { definition: active[0]!, dispose: () => active.splice(0, active.length) }
}

describe('plugin lifecycle', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('registers one text_to_speech tool with output schema and conservative timeout', () => {
    const { definition } = registerOnce()
    expect(definition.name).toBe('text_to_speech')
    expect(definition.timeoutMs).toBe(300_000)
    expect(definition.output.schema).toBeDefined()
    expect(typeof definition.output.render).toBe('function')
    const parameters = definition.parameters as { properties: Record<string, { type: string }>; required: string[] }
    expect(parameters.required).toEqual(['text'])
    expect(parameters.properties.text?.type).toBe('string')
    expect(parameters.properties.voice?.type).toBe('string')
  })

  it('enable, disable, and re-enable leave exactly one registration with no duplicates', () => {
    const first = makeContext()
    apply(first.ctx)
    expect(first.active).toHaveLength(1)
    first.disposers[0]!()
    expect(first.active).toHaveLength(0)
    apply(first.ctx)
    expect(first.active).toHaveLength(1)
  })

  it('reports a configuration error without any network request when the key is missing', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { definition } = registerOnce()
    const exec = { signal: new AbortController().signal } as Parameters<ToolDefinition['execute']>[1]
    await expect(definition.execute({ text: '你好' }, exec))
      .rejects.toThrow(/DASHSCOPE_API_KEY is not set/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('output render keeps the returned value as one text block', () => {
    const { definition } = registerOnce()
    const value = '{"audioUrl":"https://example.com/x.wav"}'
    expect(definition.output.render({}, value)).toEqual([{ type: 'text', text: value }])
  })
})
