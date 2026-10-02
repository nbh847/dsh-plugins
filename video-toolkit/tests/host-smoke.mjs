/** Opt-in Loader smoke; use only a disposable profile with the built bundle enabled. */
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const toolRequire = createRequire(require.resolve('@deepseek-ai/dsh-tools'))
const { createAssistantMessage, createUserMessage, createToolResultMessage, ToolCallId } = toolRequire('@deepseek-ai/dsh-llm')

const runFile = promisify(execFile)
async function processes() {
  const { stdout } = await runFile('ps', ['-axo', 'pid=,ppid=,command='])
  return stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : []
  })
}

export const inject = ['tools', 'agents', 'pluginManager', 'attachments', 'workspaceRegistry', 'sessionController']
export function apply(ctx, config) {
  ctx.effect(() => ctx.get('appReady').onReady(() => {
    void run().catch(async error => {
      await writeFile(config.result, JSON.stringify({ error: error.stack }, null, 2))
    })
  }))
  async function run() {
    const sessionId = `video-toolkit-smoke-${Date.now()}`
    const workspace = await ctx.workspaceRegistry.create(config.project, 'Video Toolkit validation')
    const handle = await ctx.agents.create({ sessionId, meta: { cwd: config.project } })
    const agent = handle.agent
    await workspace.attachSession(agent.session.id)
    const records = { sessionId, workspaceId: workspace.id }
    const visible = () => ['video_lint', 'video_snapshot', 'video_render'].filter(name => ctx.tools.get(name, agent) !== undefined)
    records.before = visible()
    const signal = AbortSignal.timeout(300000)
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '验证 Video Toolkit 的检查、截图与 MP4 渲染。' }] }), { surfaceOp: 'append' })
    const calls = records.before.map(name => ({
      type: 'tool-call', id: ToolCallId(`video-toolkit-${name}`), name,
      arguments: JSON.stringify({ project_path: config.project, ...(name === 'video_snapshot' ? { timestamps: [0.9, 0, 0.1, 0.1] } : {}) }),
    }))
    agent.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'fixture', model: 'scripted' }, content: calls }) }, { surfaceOp: 'append' })
    for (const name of records.before) {
      const callId = ToolCallId(`video-toolkit-${name}`)
      const args = { project_path: config.project, ...(name === 'video_snapshot' ? { timestamps: [0.9, 0, 0.1, 0.1] } : {}) }
      const call = agent.session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
      records[name] = await ctx.tools.execute({
        name, agent, callId, signal, arguments: args,
      })
      agent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: records[name].content, isError: records[name].isError }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    }
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('step/start', { turn: 1, step: 2 })
    agent.session.append('assistant/message', { turn: 1, step: 2, stream: [], message: createAssistantMessage({ source: { provider: 'fixture', model: 'scripted' }, content: [{ type: 'text', text: 'Video Toolkit 验收调用结束，产物见工具结果和文件卡片。' }] }) }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 2 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    records.deliveries = agent.session.snapshotEvents().filter(event => event.type === 'deliverables/presented').map(event => event.data)
    await writeFile(config.result + '.partial', JSON.stringify(records, null, 2))
    const image = records.video_snapshot.content.find(block => block.type === 'image').attachment
    const attachment = await ctx.sessionController.attachment({ sessionId, attachmentId: image.attachmentId })
    records.imageAccess = { attachmentId: attachment.attachment.attachmentId, bytes: Buffer.from(attachment.data, 'base64').length }
    records.disabled = await ctx.pluginManager.setBundleEnabled('dsh-plugin-video-toolkit', false)
    records.afterDisabled = visible()
    records.enabled = await ctx.pluginManager.setBundleEnabled('dsh-plugin-video-toolkit', true)
    records.afterEnabled = visible()
    const inFlight = ctx.tools.execute({ name: 'video_render', agent, callId: 'video-toolkit-cancellation', signal, arguments: { project_path: config.project } })
    let owned = []
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const rows = await processes()
      const native = rows.find(row => row.command.includes('hyperframes.mjs render') && row.command.includes(config.project))
      if (native) {
        owned = [native.pid]
        for (let i = 0; i < rows.length; i++) {
          for (const row of rows) if (owned.includes(row.parent) && !owned.includes(row.pid)) owned.push(row.pid)
        }
        if (rows.some(row => owned.includes(row.pid) && /Chrome|chrome-headless/.test(row.command))) break
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (owned.length < 2) throw new Error('Did not observe native render child resources before cancellation')
    records.inFlightPids = owned
    records.inFlightDisabled = await ctx.pluginManager.setBundleEnabled('dsh-plugin-video-toolkit', false)
    records.cancelledRender = await inFlight
    records.remainingPids = (await processes()).filter(row => owned.includes(row.pid)).map(row => row.pid)
    records.afterInFlightDisabled = visible()
    records.reenabled = await ctx.pluginManager.setBundleEnabled('dsh-plugin-video-toolkit', true)
    records.afterReenabled = visible()
    records.otherTools = ['generate_image', 'text_to_speech'].map(name => ({ name, visible: ctx.tools.get(name, agent) !== undefined }))
    await writeFile(config.result, JSON.stringify(records, null, 2))
    ctx.effect(() => () => handle.dispose())
  }
}
