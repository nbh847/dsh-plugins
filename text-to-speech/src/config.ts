/** Environment-based configuration for the Qwen-Audio-TTS text-to-speech tool. */

/** Official example model; verified against this account by the direct API smoke test. */
export const DEFAULT_MODEL = 'qwen-audio-3.0-tts-flash'

/** Beijing workspace-only path of the non-realtime SpeechSynthesizer endpoint. */
const SYNTHESIZER_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer'

/** Resolved plugin configuration; secrets stay on the host side. */
export interface TtsConfig {
  /** Bearer API key for Alibaba Cloud Model Studio (DashScope). */
  apiKey: string
  /** Workspace-specific Beijing endpoint without a path or trailing slash. */
  endpoint: string
  /** Speech synthesis model identifier. */
  model: string
  /** Server-side default voice used when the call omits `voice`; unset means calls must pass one. */
  defaultVoice: string | undefined
}

/** Missing or invalid environment configuration; the message is safe to show. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Read and validate plugin configuration from the environment. No network
 * request happens here; a missing key fails before any request is attempted.
 * @param env - environment source; defaults to `process.env`.
 * @returns the resolved configuration.
 * @throws {@link ConfigError} when a required variable is missing or invalid.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): TtsConfig {
  const apiKey = env.DASHSCOPE_API_KEY?.trim() ?? ''
  if (apiKey === '') {
    throw new ConfigError('DASHSCOPE_API_KEY is not set; add it to ~/.dsh/.env (or the dsh startup directory .env) and restart dsh.')
  }
  const workspaceId = env.DASHSCOPE_WORKSPACE_ID?.trim() ?? ''
  if (workspaceId === '') {
    throw new ConfigError('DASHSCOPE_WORKSPACE_ID is not set; Qwen-Audio-TTS is Beijing-only and requires the workspace-specific domain.')
  }
  if (!/^[A-Za-z0-9-]+$/.test(workspaceId)) {
    throw new ConfigError('DASHSCOPE_WORKSPACE_ID must contain only letters, digits, and dashes; it forms the endpoint subdomain.')
  }
  const model = env.DASHSCOPE_TTS_MODEL?.trim() || DEFAULT_MODEL
  const defaultVoice = env.DASHSCOPE_TTS_VOICE?.trim() || undefined
  return {
    apiKey,
    endpoint: `https://${workspaceId}.cn-beijing.maas.aliyuncs.com${SYNTHESIZER_PATH}`,
    model,
    defaultVoice,
  }
}
