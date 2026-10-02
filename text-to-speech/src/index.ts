/** DeepSeek Harness Cordis plugin: Qwen-Audio-TTS text-to-speech tool. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BailianError, synthesizeSpeech } from './bailian.ts'
import { ConfigError, readConfig } from './config.ts'

/** Required services; registration waits until the host tool registry exists. */
export const inject = ['tools'] as const

/**
 * Conservative wall-clock cap for one synchronous synthesis. The official API
 * publishes no latency SLA; the host timeout policy derives the request deadline
 * from this value, so no separate in-plugin timer is needed.
 */
const TOOL_TIMEOUT_MS = 300_000

/** Official per-call limit for the text to synthesize; enforced locally to fail fast. */
const MAX_TEXT_LENGTH = 20_000

/** Register the `text_to_speech` tool on the host root context. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'text_to_speech',
    description: 'Convert text to spoken audio with Qwen-Audio-TTS and return a temporary download URL (valid for 24 hours). One Chinese or English text per call; a voice from the model\'s official voice list is required, either passed per call or configured server-side. The call performs one synchronous synthesis request and waits for the result; on timeout or failure it never retries automatically because the provider may bill a completed synthesis.',
    parameters: {
      text: { type: 'string', required: true, description: `Text to synthesize, Chinese or English, 1-${MAX_TEXT_LENGTH} characters; forwarded verbatim without rewriting.` },
      voice: { type: 'string', description: 'Voice from the current model\'s official Qwen-Audio-TTS voice list (e.g. longanhuan_v3.6). Omitted calls use the server-configured default voice; the call fails when neither is available.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if (typeof args.text !== 'string' || args.text.trim() === '') {
        throw new BailianError('text is required: provide non-empty text to synthesize')
      }
      if (args.text.length > MAX_TEXT_LENGTH) {
        throw new BailianError(`text is too long: ${args.text.length} characters exceed the official limit of ${MAX_TEXT_LENGTH} per call`)
      }
      let config
      try {
        config = readConfig()
      } catch (error) {
        if (error instanceof ConfigError) throw new BailianError(error.message)
        throw error
      }
      const voice = args.voice?.trim() || config.defaultVoice
      if (voice === undefined) {
        throw new BailianError('no voice available: pass voice, or set DASHSCOPE_TTS_VOICE in the host environment')
      }
      const result = await synthesizeSpeech({
        apiKey: config.apiKey,
        endpoint: config.endpoint,
        model: config.model,
        text: args.text,
        voice,
        signal: exec.signal,
      })
      const usage = [
        result.usage.characters,
        result.usage.inputTokens,
        result.usage.outputTokens,
        result.usage.totalTokens,
      ].some(value => value !== undefined)
      return JSON.stringify({
        audioUrl: result.url,
        ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt }),
        requestId: result.requestId,
        ...(usage ? { usage: {
          ...(result.usage.characters === undefined ? {} : { characters: result.usage.characters }),
          ...(result.usage.inputTokens === undefined ? {} : { inputTokens: result.usage.inputTokens }),
          ...(result.usage.outputTokens === undefined ? {} : { outputTokens: result.usage.outputTokens }),
          ...(result.usage.totalTokens === undefined ? {} : { totalTokens: result.usage.totalTokens }),
        } } : {}),
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Text to speech',
      kind: 'other',
      rawInput: { text: args.text },
    }),
  }))
}
