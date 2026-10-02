/** HyperFrames process adapter using the host's confinement and managed subprocesses. */
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { mkdtemp, realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'

export interface CommandResult { exitCode: number; stdout: string; stderr: string }
export type RunCommand = (args: string[], cwd: string, signal: AbortSignal) => Promise<CommandResult>

/** Resolve the pinned dependency's CLI without executing project scripts. */
export function cliPath(): string {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs')
}

/** Resolve an absolute HyperFrames project; real paths prevent symlink-prefix bypasses. */
export async function projectPath(input: string): Promise<string> {
  if (typeof input !== 'string' || !isAbsolute(input)) throw new Error('project_path must be an absolute directory path')
  const path = await realpath(input)
  if (!(await stat(path)).isDirectory()) throw new Error('project_path must be a directory')
  if (!(await stat(join(path, 'index.html'))).isFile()) throw new Error('HyperFrames project requires index.html')
  return path
}

/** Validate a project's relation to the real workspace before creating any output. */
export async function authorizeProject(ctx: Context, exec: ToolExecution, path: string, writes: boolean): Promise<void> {
  const policy = ctx.sandboxPolicy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
  if (policy.mode === 'danger-full-access') return
  if (writes && policy.mode === 'read-only') throw new Error('snapshot/render require workspace-write permission')
  const root = await realpath(policy.workspaceRoot)
  const offset = relative(root, path)
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new Error('project_path must be inside the session workspace under the current file policy')
  }
}

/** Run one native command; its managed range is terminated and awaited before returning. */
export function commandRunner(ctx: Context, exec: ToolExecution, lifetime: AbortSignal): RunCommand {
  return async (args, cwd, caller) => {
    const signal = AbortSignal.any([caller, exec.signal, lifetime])
    signal.throwIfAborted()
    const policy = ctx.sandboxPolicy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
    let argv = [process.execPath, cliPath(), ...args]
    if (policy.mode !== 'danger-full-access') {
      argv = (await ctx.sandbox.confine(argv, { ...policy, mode: policy.mode }, signal)).argv
    }
    signal.throwIfAborted()
    const processHandle = ctx.subprocess.spawn({
      argv, cwd, signal, graceMs: 2000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_048_576 }, stderr: { maxBytes: 65_536 } },
      env: {
        HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_TELEMETRY: '1',
        DO_NOT_TRACK: '1', NODE_OPTIONS: undefined, NODE_PATH: undefined,
      },
    })
    try {
      const outcome = await processHandle.done
      signal.throwIfAborted()
      const stdout = processHandle.collected.stdout?.readFrom(0)
      const stderr = processHandle.collected.stderr?.readFrom(0)
      if (stdout?.lossy) throw new Error('HyperFrames output exceeds the 1 MiB result limit')
      if (outcome.exitCode === null) throw new Error(`HyperFrames terminated by ${outcome.signal}`)
      return { exitCode: outcome.exitCode, stdout: stdout?.text ?? '', stderr: stderr?.text ?? '' }
    } finally {
      processHandle.terminate()
      if (!await processHandle.waitForExit(AbortSignal.timeout(10_000))) {
        throw new Error('HyperFrames process range did not stop within cleanup deadline')
      }
    }
  }
}

/** Create a unique persistent result directory inside the authorized project. */
export async function outputDirectory(project: string): Promise<string> {
  return mkdtemp(join(project, 'video-toolkit-'))
}
