import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolExecution, ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { render } from '../src/video.ts'

vi.mock('../src/runner.ts', () => ({
  projectPath: async (path: string) => path,
  authorizeProject: async () => {},
  outputDirectory: async () => '/output',
  commandRunner: () => vi.fn(),
}))
vi.mock('../src/video.ts', () => ({ render: vi.fn(), lint: vi.fn(), snapshot: vi.fn() }))
const directories: string[] = []
afterEach(async () => { vi.resetAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function harness(openTurn = true) {
  const directory = await mkdtemp(join(tmpdir(), 'video-toolkit-register-'))
  directories.push(directory)
  const path = join(directory, 'video.mp4')
  await writeFile(path, 'test-video')
  vi.mocked(render).mockResolvedValue({ projectPath: directory, path, bytes: 10 })
  const tools: ToolDefinition[] = []
  let dispose!: () => Promise<void>
  let settled!: (exec: ToolExecution, result: ToolExecutionResult) => void
  const append = vi.fn()
  const ctx = {
    tools: { register: (tool: ToolDefinition) => { tools.push(tool) } },
    effect: (effect: () => () => Promise<void>) => { dispose = effect() },
    on: (_event: string, listener: typeof settled) => { settled = listener },
    get: () => ({ stateOf: () => ({ openTurnStartSeq: openTurn ? 1 : null, lastTurn: 2 }) }),
    attachments: { saveFileStream: async ({ data }: { data: AsyncIterable<unknown> }) => {
      for await (const _chunk of data) { /* Consume the owned file stream. */ }
      return { attachmentId: 'sha256:test', mediaType: 'video/mp4', name: 'video.mp4', bytes: 10 }
    } },
  } as unknown as Context
  apply(ctx)
  const exec = { signal: new AbortController().signal, callId: 'render-call', agent: { session: { append } } } as unknown as ToolRunContext
  const tool = tools.find(tool => tool.name === 'video_render')!
  return { tools, exec, tool, append, path, dispose: () => dispose(), settled: (result: ToolExecutionResult) => { settled(exec, result) } }
}

describe('tool registration and deliveries', () => {
  it('registers exactly three tools and declares the rendered MP4 after final success', async () => {
    const h = await harness()
    expect(h.tools.map(tool => tool.name)).toEqual(['video_lint', 'video_snapshot', 'video_render'])
    const value = await h.tool.execute({ project_path: '/project' }, h.exec) as string
    const content = h.tool.output.render({ project_path: '/project' }, value)
    expect(content.map(block => block.type)).toEqual(['text', 'file'])
    h.settled({ isError: false, content, value })
    expect(h.append).toHaveBeenCalledWith('deliverables/presented', { turn: 2, callId: 'render-call', files: [{ path: h.path, description: 'HyperFrames MP4' }] })
    h.settled({ isError: false, content, value })
    expect(h.append).toHaveBeenCalledTimes(1)
  })
  it('does not present a file if a later pipeline stage rejects the result', async () => {
    const h = await harness()
    await h.tool.execute({ project_path: '/project' }, h.exec)
    h.settled({ isError: true, error: { message: 'rejected' }, content: [{ type: 'text', text: 'rejected' }] })
    expect(h.append).not.toHaveBeenCalled()
  })
  it('retains the file attachment without fabricating a turn when no turn is open', async () => {
    const h = await harness(false)
    const value = await h.tool.execute({ project_path: '/project' }, h.exec) as string
    h.settled({ isError: false, content: h.tool.output.render({}, value), value })
    expect(h.append).not.toHaveBeenCalled()
  })
  it('aborts and awaits in-flight work on unload and rejects further calls', async () => {
    const h = await harness()
    vi.mocked(render).mockImplementationOnce(async (_project, _output, _runner, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    }))
    const operation = h.tool.execute({ project_path: '/project' }, h.exec)
    const rejection = expect(operation).rejects.toThrow('disabled or unloaded')
    await vi.waitFor(() => { expect(render).toHaveBeenCalled() })
    await h.dispose()
    await rejection
    await expect(h.tool.execute({ project_path: '/project' }, h.exec)).rejects.toThrow('disabled or unloaded')
  })
})
