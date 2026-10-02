/** Cordis registration for the three HyperFrames Agent Tools. */
import { readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef, FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { authorizeProject, commandRunner, outputDirectory, projectPath } from './runner.ts'
import { lint, render, snapshot } from './video.ts'

/** Runtime services must be present before tool registration. */
export const inject = ['tools', 'subprocess', 'sandbox', 'sandboxPolicy', 'attachments'] as const

const pathParameter = { type: 'string', required: true, description: 'Absolute directory path of a HyperFrames project containing index.html.' } as const

/** Register tools with an awaited unload lifetime, preserving the host's process confinement. */
export function apply(ctx: Context): void {
  const lifetime = new AbortController()
  const pending = new Set<Promise<unknown>>()
  const deliveries = new WeakMap<ToolExecution, { path: string; turn: number }>()
  ctx.on('tools/result', (exec, result) => {
    const delivery = deliveries.get(exec)
    deliveries.delete(exec)
    if (delivery === undefined || result.isError || exec.agent === undefined) return
    exec.agent.session.append('deliverables/presented', {
      turn: delivery.turn, callId: exec.callId,
      files: [{ path: delivery.path, description: 'HyperFrames MP4' }],
    })
  })
  ctx.effect(() => async () => {
    lifetime.abort(new Error('Video Toolkit disabled or unloaded'))
    await Promise.allSettled([...pending])
  })

  async function execute<T>(exec: ToolExecution, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = AbortSignal.any([exec.signal, lifetime.signal])
    signal.throwIfAborted()
    const operation = task(signal)
    pending.add(operation)
    try { return await operation } finally { pending.delete(operation) }
  }

  ctx.tools.register(defineTool({
    name: 'video_lint', description: 'Run native HyperFrames static contract lint on an existing project. Returns findings; does not perform runtime or visual validation.',
    parameters: { project_path: pathParameter },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => execute(exec, async signal => {
      const project = await projectPath(args.project_path)
      await authorizeProject(ctx, exec, project, false)
      return JSON.stringify(await lint(project, commandRunner(ctx, exec, lifetime.signal), signal))
    }),
    presentCall: args => ({ card: 'generic', title: 'HyperFrames lint', kind: 'read', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'video_snapshot', description: 'Capture 1-9 exact timestamps (seconds) from a HyperFrames project and return the native 3-column contact sheet as an image. Preserves input order and duplicates; timestamps must be before duration.',
    parameters: {
      project_path: pathParameter,
      timestamps: { type: 'array', required: true, items: { type: 'number' }, description: '1-9 finite seconds values, each >= 0 and < project duration, in desired grid order.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => {
        const parsed = JSON.parse(value) as { image: ImageAttachmentRef }
        return [{ type: 'text', text: value }, { type: 'image', attachment: parsed.image }]
      },
    },
    timeoutMs: 300_000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => execute(exec, async signal => {
      const project = await projectPath(args.project_path)
      await authorizeProject(ctx, exec, project, true)
      if (args.timestamps.length < 1 || args.timestamps.length > 9 || args.timestamps.some(t => !Number.isFinite(t) || t < 0)) {
        throw new Error('timestamps must contain 1-9 finite non-negative seconds values')
      }
      const result = await snapshot(project, args.timestamps, await outputDirectory(project), commandRunner(ctx, exec, lifetime.signal), signal)
      signal.throwIfAborted()
      const data = await readFile(result.sheetPath, { signal })
      const image = await ctx.attachments.saveImage({ data, mediaType: 'image/jpeg', name: basename(result.sheetPath) })
      signal.throwIfAborted()
      return JSON.stringify({ ...result, image })
    }),
    presentCall: args => ({ card: 'generic', title: 'HyperFrames snapshots', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'video_render', description: 'Render an existing HyperFrames project to a local MP4 using the native renderer and return a downloadable file attachment. Writes to a unique directory; no source changes or automatic retries.',
    parameters: { project_path: pathParameter },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => {
        const parsed = JSON.parse(value) as { file: FileAttachmentRef }
        return [{ type: 'text', text: value }, { type: 'file', attachment: parsed.file }]
      },
    },
    timeoutMs: 1_800_000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => execute(exec, async signal => {
      const project = await projectPath(args.project_path)
      await authorizeProject(ctx, exec, project, true)
      const result = await render(project, await outputDirectory(project), commandRunner(ctx, exec, lifetime.signal), signal)
      signal.throwIfAborted()
      const file = await ctx.attachments.saveFileStream({ data: createReadStream(result.path), name: 'video.mp4', signal })
      signal.throwIfAborted()
      if (exec.agent !== undefined) {
        const boundary = ctx.get('sessionProjections')?.stateOf(exec.agent.session, 'turnBoundary')
        if (boundary !== undefined && boundary.openTurnStartSeq !== null) {
          deliveries.set(exec, { path: result.path, turn: boundary.lastTurn })
        }
      }
      return JSON.stringify({ ...result, file })
    }),
    presentCall: args => ({ card: 'generic', title: 'HyperFrames MP4 render', kind: 'other', rawInput: args }),
  }))
}
