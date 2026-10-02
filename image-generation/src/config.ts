/** Environment-based configuration for the SenseNova image generation tool. */

/** Official SenseNova Token Plan API origin (synchronous image endpoints). */
export const DEFAULT_BASE_URL = 'https://token.sensenova.cn'

/** Official U1.5 Lite model identifier. */
export const DEFAULT_MODEL = 'sensenova-u1.5-lite'

/** Resolved plugin configuration; secrets stay on the host side. */
export interface ImageGenerationConfig {
  /** Bearer API key for the SenseNova Token Plan. */
  apiKey: string
  /** API origin without a trailing slash. */
  baseUrl: string
  /** Image generation model identifier. */
  model: string
}

/** Missing or invalid environment configuration; the message is safe to show. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Base-URL path suffixes accepted for convenience and stripped to the origin. */
const KNOWN_BASE_PATHS = ['/v1/images/generations', '/v1/images/edits', '/v1']

function normalizeBaseUrl(raw: string, variable: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new ConfigError(`${variable} must be a valid absolute URL.`)
  }
  if (parsed.protocol !== 'https:') {
    throw new ConfigError(`${variable} must use https.`)
  }
  const path = parsed.pathname.replace(/\/+$/, '')
  if (path !== '' && !KNOWN_BASE_PATHS.includes(path)) {
    throw new ConfigError(`${variable} must be the API origin (https://token.sensenova.cn), optionally ending with /v1 or the full endpoint path.`)
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new ConfigError(`${variable} must not contain a query or fragment.`)
  }
  return parsed.origin
}

/**
 * Read and validate plugin configuration from the environment. No network
 * request happens here; a missing key fails before any request is attempted.
 * @param env - environment source; defaults to `process.env`.
 * @returns the resolved configuration.
 * @throws {@link ConfigError} when the key is missing or optional overrides are invalid.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ImageGenerationConfig {
  const apiKey = env.SENSENOVA_API_KEY?.trim() ?? ''
  if (apiKey === '') {
    throw new ConfigError('SENSENOVA_API_KEY is not set; add it to ~/.dsh/.env (or the shell environment) and restart dsh.')
  }
  const rawBaseUrl = env.SENSENOVA_BASE_URL?.trim() ?? ''
  const rawModel = env.SENSENOVA_IMAGE_MODEL?.trim() ?? ''
  return {
    apiKey,
    baseUrl: rawBaseUrl === '' ? DEFAULT_BASE_URL : normalizeBaseUrl(rawBaseUrl, 'SENSENOVA_BASE_URL'),
    model: rawModel === '' ? DEFAULT_MODEL : rawModel,
  }
}
