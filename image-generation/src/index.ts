/** DeepSeek Harness Cordis plugin: SenseNova U1.5 Lite image generation tool. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ConfigError, readConfig } from './config.ts'
import { SensenovaError, generateImage } from './sensenova.ts'

/** Required services; registration waits until the host tool registry exists. */
export const inject = ['tools'] as const

/**
 * Conservative wall-clock cap for one synchronous generation. The official API
 * publishes no latency SLA; the host timeout policy derives the request deadline
 * from this value, so no separate in-plugin timer is needed.
 */
const TOOL_TIMEOUT_MS = 300_000

/** Official size constraints: width and height are multiples of 32 in [512, 4096]. */
const SIZE_PATTERN = /^(?:auto|2K|4K|[1-9]\d{2,3}x[1-9]\d{2,3})$/

function isValidSize(value: string): boolean {
  if (value === 'auto' || value === '2K' || value === '4K') return true
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (match === null) return false
  const width = Number(match[1])
  const height = Number(match[2])
  return width >= 512 && width <= 4096 && height >= 512 && height <= 4096
    && width % 32 === 0 && height % 32 === 0
}

/** Register the `generate_image` tool on the host root context. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate an image from a text prompt with SenseNova U1.5 Lite and return a temporary download URL (valid for 24 hours). The call performs one synchronous generation request and waits for the result; on timeout or failure it never retries automatically because the provider may bill a completed generation.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Image description in natural language, Chinese or English.' },
      size: { type: 'string', description: 'Optional image size: "auto", "2K", "4K", or "{width}x{height}" with values that are multiples of 32 between 512 and 4096 (aspect ratio at most 3:1).' },
      watermark: { type: 'boolean', description: 'Add the SenseNova logo watermark; defaults to false (clean image, free during public beta).' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if (args.prompt.trim() === '') {
        throw new SensenovaError('prompt is required: provide a non-empty image description')
      }
      let config
      try {
        config = readConfig()
      } catch (error) {
        if (error instanceof ConfigError) throw new SensenovaError(error.message)
        throw error
      }
      if (args.size !== undefined && !isValidSize(args.size)) {
        throw new SensenovaError(`invalid size "${args.size}": use "auto", "2K", "4K", or {width}x{height} with multiples of 32 between 512 and 4096`)
      }
      const result = await generateImage({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        prompt: args.prompt,
        ...(args.size === undefined ? {} : { size: args.size }),
        watermark: args.watermark ?? false,
        signal: exec.signal,
      })
      return JSON.stringify({
        imageUrl: result.url,
        ...(result.size === undefined ? {} : { size: result.size }),
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Generate image',
      kind: 'other',
      rawInput: { prompt: args.prompt },
    }),
  }))
}
