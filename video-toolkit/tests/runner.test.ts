import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeProject, commandRunner, outputDirectory, projectPath } from '../src/runner.ts'

const directories: string[] = []
async function directory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'video-toolkit-runner-')))
  directories.push(path)
  return path
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const signal = new AbortController().signal
const exec = { signal } as ToolExecution

function harness(mode = 'workspace-write', workspaceRoot = '/workspace') {
  const handle = {
    done: Promise.resolve({ exitCode: 0, signal: null }),
    collected: { stdout: { readFrom: vi.fn(() => ({ text: 'result', lossy: false })) }, stderr: { readFrom: vi.fn(() => ({ text: 'diagnostic', lossy: false })) } },
    terminate: vi.fn(), waitForExit: vi.fn(async () => true),
  }
  const services = {
    sandboxPolicy: { resolve: vi.fn(() => ({ mode, workspaceRoot })) },
    sandbox: { confine: vi.fn(async (argv: string[]) => ({ argv: ['confined', ...argv] })) },
    subprocess: { spawn: vi.fn((_options: { signal: AbortSignal; argv: string[]; cwd: string }) => handle) },
  }
  return { ...services, handle, ctx: services as unknown as Context }
}

describe('file policy', () => {
  it('rejects read-only writes before starting a process', async () => {
    const h = harness('read-only', await directory())
    await expect(authorizeProject(h.ctx, exec, '/outside', true)).rejects.toThrow('workspace-write')
    expect(h.subprocess.spawn).not.toHaveBeenCalled()
  })
  it('rejects sibling prefix paths and symlinks escaping the real workspace', async () => {
    const root = await directory()
    const outside = await directory()
    await writeFile(join(outside, 'index.html'), '<html></html>')
    await symlink(outside, join(root, 'linked'))
    const h = harness('workspace-write', root)
    await expect(authorizeProject(h.ctx, exec, `${root}-sibling`, false)).rejects.toThrow('inside')
    await expect(authorizeProject(h.ctx, exec, await projectPath(join(root, 'linked')), true)).rejects.toThrow('inside')
    await expect(authorizeProject(h.ctx, exec, root, false)).resolves.toBeUndefined()
  })
  it('rejects file paths and directory entries named index.html', async () => {
    const root = await directory()
    await writeFile(join(root, 'file.html'), 'html')
    await mkdir(join(root, 'index.html'))
    await expect(projectPath(join(root, 'file.html'))).rejects.toThrow('directory')
    await expect(projectPath(root)).rejects.toThrow('index.html')
    await expect(projectPath(join(root, 'missing'))).rejects.toThrow()
  })
  it('isolates simultaneous output directories without overwriting an existing file', async () => {
    const root = await directory()
    const original = join(root, 'video.mp4')
    await writeFile(original, 'existing')
    const outputs = await Promise.all(Array.from({ length: 10 }, () => outputDirectory(root)))
    expect(new Set(outputs).size).toBe(10)
    expect(outputs.every(path => path.startsWith(`${root}/video-toolkit-`))).toBe(true)
  })
})

describe('managed process adapter', () => {
  it('refuses a missing pinned CLI instead of downloading a replacement', async () => {
    vi.doMock('node:module', () => ({ createRequire: () => ({ resolve: () => { throw new Error('missing CLI dependency') } }) }))
    vi.resetModules()
    try {
      const isolated = await import('../src/runner.ts')
      const h = harness()
      await expect(isolated.commandRunner(h.ctx, exec, signal)([], '/workspace', signal)).rejects.toThrow('missing CLI dependency')
      expect(h.subprocess.spawn).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('node:module')
      vi.resetModules()
    }
  })
  it('confines exact argv and awaits termination before returning', async () => {
    const h = harness()
    const args = ['lint', '/workspace/中文 $(echo unsafe)', '--json']
    await expect(commandRunner(h.ctx, exec, signal)(args, '/workspace', signal)).resolves.toEqual({ exitCode: 0, stdout: 'result', stderr: 'diagnostic' })
    expect(h.sandbox.confine.mock.calls[0]?.[0].slice(-3)).toEqual(args)
    expect(h.subprocess.spawn.mock.calls[0]?.[0]).toMatchObject({ argv: expect.arrayContaining(args), cwd: '/workspace', env: { NODE_OPTIONS: undefined, NODE_PATH: undefined, DO_NOT_TRACK: '1' } })
    expect(h.handle.terminate).toHaveBeenCalledTimes(1)
    expect(h.handle.waitForExit).toHaveBeenCalledTimes(1)
  })
  it('fails closed if confinement fails', async () => {
    const h = harness()
    h.sandbox.confine.mockRejectedValueOnce(new Error('sandbox unavailable'))
    await expect(commandRunner(h.ctx, exec, signal)([], '/workspace', signal)).rejects.toThrow('sandbox unavailable')
    expect(h.subprocess.spawn).not.toHaveBeenCalled()
  })
  it('refuses a pre-cancelled call without spawning', async () => {
    const h = harness()
    await expect(commandRunner(h.ctx, exec, signal)([], '/workspace', AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    expect(h.subprocess.spawn).not.toHaveBeenCalled()
  })
  it.each(['caller', 'lifetime', 'timeout'] as const)('propagates %s cancellation and joins process cleanup', async source => {
    const h = harness('danger-full-access')
    const caller = new AbortController()
    const lifetime = new AbortController()
    const timeout = source === 'timeout' ? AbortSignal.timeout(10) : signal
    h.subprocess.spawn.mockImplementationOnce((options: { signal: AbortSignal }) => {
      h.handle.done = new Promise(resolve => {
        options.signal.addEventListener('abort', () => { resolve({ exitCode: 0, signal: null }) }, { once: true })
      })
      return h.handle
    })
    const operation = commandRunner(h.ctx, { signal: timeout } as ToolExecution, lifetime.signal)([], '/workspace', caller.signal)
    if (source === 'caller') caller.abort(new Error('caller cancelled'))
    if (source === 'lifetime') lifetime.abort(new Error('unloaded'))
    await expect(operation).rejects.toThrow(source === 'caller' ? 'caller cancelled' : source === 'lifetime' ? 'unloaded' : 'timeout')
    expect(h.handle.terminate).toHaveBeenCalledTimes(1)
    expect(h.handle.waitForExit).toHaveBeenCalledTimes(1)
  })
  it('rejects truncated stdout and still performs cleanup', async () => {
    const h = harness('danger-full-access')
    h.handle.collected.stdout.readFrom.mockReturnValueOnce({ text: 'truncated', lossy: true })
    await expect(commandRunner(h.ctx, exec, signal)([], '/workspace', signal)).rejects.toThrow('1 MiB')
    expect(h.handle.terminate).toHaveBeenCalledTimes(1)
  })
  it('rejects unconfirmed process cleanup instead of reporting success', async () => {
    const h = harness('danger-full-access')
    h.handle.waitForExit.mockResolvedValueOnce(false)
    await expect(commandRunner(h.ctx, exec, signal)([], '/workspace', signal)).rejects.toThrow('cleanup deadline')
  })
})
