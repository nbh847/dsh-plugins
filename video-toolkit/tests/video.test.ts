import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lint, snapshot, render, timestamps, jsonResult } from '../src/video.ts'
import { projectPath } from '../src/runner.ts'
import type { RunCommand } from '../src/runner.ts'

const signal = new AbortController().signal
const directories: string[] = []
async function directory() { const path = await mkdtemp(join(tmpdir(), 'video-toolkit-test-')); directories.push(path); return path }
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('native static lint', () => {
  it.each([0, 2])('returns real findings for %i errors', async errorCount => {
    const value = { ok: errorCount === 0, errorCount, warningCount: 1, findings: [{ severity: 'warning' }] }
    const run = vi.fn<RunCommand>().mockResolvedValue({ exitCode: errorCount ? 1 : 0, stdout: JSON.stringify(value), stderr: '' })
    expect(await lint('/project', run, signal)).toEqual(value)
    expect(run).toHaveBeenCalledWith(['lint', '/project', '--json'], '/project', signal)
  })
  it('does not report execution failure as findings', async () => {
    const run = vi.fn<RunCommand>().mockResolvedValue({ exitCode: 1, stdout: JSON.stringify({ error: 'missing entry' }), stderr: '' })
    await expect(lint('/project', run, signal)).rejects.toThrow('missing entry')
  })
  it('rejects truncated or invalid CLI JSON', () => {
    expect(() => jsonResult({ exitCode: 0, stdout: '{', stderr: '' })).toThrow('invalid JSON')
    expect(() => jsonResult({ exitCode: 0, stdout: '[]', stderr: '' })).toThrow('JSON object')
  })
})

describe('timestamp limits', () => {
  it.each([[], Array(10).fill(1), [-1], [NaN], [Infinity], [2], [3], ['1']])('rejects %j', input => {
    expect(() => timestamps(input as number[], 2)).toThrow()
  })
  it('preserves order, duplicate times, first frame and final-minus-epsilon', () => {
    expect(timestamps([1.999, 0, 1, 1], 2)).toEqual([1.999, 0, 1, 1])
  })
})

describe('snapshot output', () => {
  it.each([1, 3, 4, 9])('captures exactly %i frames with no implicit end frame', async count => {
    const output = await directory()
    const run = vi.fn<RunCommand>().mockImplementation(async args => {
      if (args[0] === 'info') return { exitCode: 0, stdout: JSON.stringify({ duration: 10 }), stderr: '' }
      for (let i = 0; i < count; i++) await writeFile(join(output, `frame-${String(i).padStart(2, '0')}-at-${i}s.png`), 'frame')
      await writeFile(join(output, 'contact-sheet.jpg'), 'sheet')
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const result = await snapshot('/project', Array.from({ length: count }, (_, i) => i), output, run, signal)
    expect(result.frames.map(frame => frame.time)).toEqual(Array.from({ length: count }, (_, i) => i))
    expect(result.columns).toBe(3)
    expect(result.rows).toBe(Math.ceil(count / 3))
    expect(run.mock.calls[1]?.[0]).toContain('--no-end')
    expect(run.mock.calls[1]?.[0]).toContain(output)
  })
  it('refuses missing contact sheet even when CLI exits zero', async () => {
    const output = await directory()
    await writeFile(join(output, 'frame-00-at-0s.png'), 'frame')
    const run = vi.fn<RunCommand>().mockResolvedValue({ exitCode: 0, stdout: '{"duration":1}', stderr: '' })
    await expect(snapshot('/project', [0], output, run, signal)).rejects.toThrow()
  })
})

describe('render output', () => {
  it('rejects success with no MP4', async () => {
    const run = vi.fn<RunCommand>().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await expect(render('/project', await directory(), run, signal)).rejects.toThrow()
  })
  it('surfaces command failure without retrying', async () => {
    const run = vi.fn<RunCommand>().mockResolvedValue({ exitCode: 2, stdout: '', stderr: 'encoder unavailable' })
    await expect(render('/project', await directory(), run, signal)).rejects.toThrow('encoder unavailable')
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('project validation', () => {
  it('rejects relative paths and non-project directories', async () => {
    await expect(projectPath('relative')).rejects.toThrow('absolute')
    await expect(projectPath(await directory())).rejects.toThrow()
  })
  it('accepts absolute project paths with spaces and Chinese names', async () => {
    const output = await directory()
    const project = join(output, '中文 project')
    await mkdir(project)
    await writeFile(join(project, 'index.html'), '<html></html>')
    expect(await projectPath(project)).toBe(await realpath(project))
  })
})
