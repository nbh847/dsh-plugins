/** Native CLI operations and JSON/file validation, independent of the Agent registry. */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunCommand, CommandResult } from './runner.ts'

/** Parse a CLI JSON object, refusing malformed or diagnostic-only output. */
export function jsonResult(result: CommandResult): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(result.stdout) } catch (_invalidJson) {
    throw new Error(`HyperFrames returned invalid JSON (exit ${result.exitCode}): ${result.stderr.slice(-2000)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('HyperFrames did not return a JSON object')
  return parsed as Record<string, unknown>
}

/** Verify CLI success, preserving bounded diagnostics on failure. */
export function assertSuccess(result: CommandResult): void {
  if (result.exitCode !== 0) throw new Error(`HyperFrames failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).slice(-4000)}`)
}

/** Native static lint findings remain available even when lint exits with errors. */
export async function lint(project: string, run: RunCommand, signal: AbortSignal): Promise<Record<string, unknown>> {
  const result = await run(['lint', project, '--json'], project, signal)
  const value = jsonResult(result)
  if (typeof value.error === 'string') throw new Error(`HyperFrames lint failed: ${value.error}`)
  if (!Array.isArray(value.findings) || typeof value.errorCount !== 'number' || typeof value.ok !== 'boolean') {
    throw new Error('HyperFrames lint result is missing findings/errorCount/ok')
  }
  if (result.exitCode !== (value.errorCount > 0 ? 1 : 0)) throw new Error('HyperFrames lint exit code disagrees with findings')
  return value
}

/** Validate model-supplied seconds without sorting, deduplicating or clamping. */
export function timestamps(input: number[], duration: number): number[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 9) throw new Error('timestamps must contain 1-9 seconds values')
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('HyperFrames project duration must be positive')
  if (input.some(time => typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time >= duration)) {
    throw new Error(`timestamps must be finite seconds in [0, ${duration}); use a time before the end frame`)
  }
  return [...input]
}

/** Capture exact requested times and the CLI's native 3-column contact sheet. */
export async function snapshot(project: string, times: number[], output: string, run: RunCommand, signal: AbortSignal) {
  const infoResult = await run(['info', project, '--json'], project, signal)
  assertSuccess(infoResult)
  const info = jsonResult(infoResult)
  if (typeof info.duration !== 'number') throw new Error('HyperFrames info has no numeric duration')
  const values = timestamps(times, info.duration)
  const result = await run(['snapshot', project, '--at', values.join(','), '--no-end', '--describe', 'false', '--output', output], project, signal)
  assertSuccess(result)
  const names = (await readdir(output)).filter(name => /^frame-\d+-at-.*\.png$/.test(name)).sort()
  if (names.length !== values.length) throw new Error(`Expected ${values.length} snapshots, found ${names.length}`)
  const frames = await Promise.all(names.map(async (name, index) => {
    const path = join(output, name)
    await nonemptyFile(path)
    if (!name.startsWith(`frame-${String(index).padStart(2, '0')}-`)) throw new Error('HyperFrames frame order is invalid')
    return { path, time: values[index]! }
  }))
  const sheetPath = join(output, 'contact-sheet.jpg')
  await nonemptyFile(sheetPath)
  return { projectPath: project, frames, sheetPath, columns: 3, rows: Math.ceil(values.length / 3) }
}

/** Require a regular, non-empty file created in this call's unique output location. */
export async function nonemptyFile(path: string): Promise<number> {
  const info = await stat(path)
  if (!info.isFile() || info.size === 0) throw new Error(`HyperFrames output is empty or not a file: ${path}`)
  return info.size
}

/** Render using native MP4 defaults; callers choose a unique output directory. */
export async function render(project: string, output: string, run: RunCommand, signal: AbortSignal) {
  const path = join(output, 'video.mp4')
  const result = await run(['render', project, '--output', path], project, signal)
  assertSuccess(result)
  const bytes = await nonemptyFile(path)
  return { projectPath: project, path, bytes }
}
