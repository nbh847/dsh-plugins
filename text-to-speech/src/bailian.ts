/** Qwen-Audio-TTS non-streaming speech synthesis client (Beijing workspace domain). */

/** One completed synthesis as returned by the official API (24-hour audio URL). */
export interface SynthesisResult {
  /** Echoed request identifier; quote it when contacting Alibaba Cloud support. */
  requestId: string | undefined
  /** Temporary download URL; expires after 24 hours. */
  url: string
  /** Unix timestamp (seconds) when the audio URL expires, as reported by the API. */
  expiresAt: number | undefined
  /** Usage reported by the API: billed characters for 3.0 models, tokens for 3.1. */
  usage: {
    characters: number | undefined
    inputTokens: number | undefined
    outputTokens: number | undefined
    totalTokens: number | undefined
  }
}

/** Normalized API failure; messages carry the status and API code, never credentials. */
export class BailianError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BailianError'
  }
}

/** Request for one non-streaming synthesis. */
export interface SynthesizeSpeechRequest {
  apiKey: string
  /** Complete workspace-specific endpoint URL. */
  endpoint: string
  model: string
  /** Text to synthesize; forwarded without rewriting. */
  text: string
  /** Voice from the current model's official voice list. */
  voice: string
  /** Caller-owned abort signal (tool cancellation and timeout deadline). */
  signal: AbortSignal
}

/** Audio container and sample rate fixed server-side; verified by the smoke test. */
const OUTPUT_FORMAT = 'wav'
const SAMPLE_RATE = 24000

/** Extract a safe error description from an API payload without leaking request data. */
function apiDetail(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as { code?: unknown; message?: unknown; request_id?: unknown }
  const parts: string[] = []
  if (typeof record.code === 'string' || typeof record.code === 'number') parts.push(String(record.code))
  if (typeof record.message === 'string' && record.message !== '') parts.push(record.message)
  if (typeof record.request_id === 'string' && record.request_id !== '') parts.push(`request_id: ${record.request_id}`)
  return parts.length === 0 ? undefined : parts.join(': ')
}

/** Build the normalized failure for a non-2xx response. */
function responseError(status: number, payload: unknown): BailianError {
  const detail = apiDetail(payload)
  const label = status === 401 || status === 403
    ? 'authentication failed; check DASHSCOPE_API_KEY and the Beijing workspace'
    : status === 429
      ? 'rate limited by Model Studio; retry later'
      : `Bailian API error (HTTP ${status})`
  return new BailianError(detail === undefined ? label : `${label}: ${detail}`)
}

/** Validate the success payload against the official non-streaming contract. */
function validateResponse(payload: unknown): SynthesisResult {
  if (typeof payload !== 'object' || payload === null) {
    throw new BailianError('invalid API response: expected a JSON object')
  }
  const record = payload as { request_id?: unknown; output?: unknown; usage?: unknown }
  if (typeof record.request_id !== 'string' || record.request_id === '') {
    throw new BailianError('invalid API response: request_id is missing')
  }
  if (typeof record.output !== 'object' || record.output === null) {
    throw new BailianError('invalid API response: output is missing')
  }
  const output = record.output as { audio?: unknown }
  if (typeof output.audio !== 'object' || output.audio === null) {
    throw new BailianError('invalid API response: output.audio is missing')
  }
  const audio = output.audio as { url?: unknown; expires_at?: unknown }
  if (typeof audio.url !== 'string' || audio.url === '') {
    throw new BailianError('invalid API response: output.audio.url is missing')
  }
  const usageSource = (typeof record.usage === 'object' && record.usage !== null ? record.usage : {}) as {
    characters?: unknown
    input_tokens?: unknown
    output_tokens?: unknown
    total_tokens?: unknown
  }
  const numberOrUndefined = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  return {
    requestId: record.request_id,
    url: audio.url,
    expiresAt: numberOrUndefined(audio.expires_at),
    usage: {
      characters: numberOrUndefined(usageSource.characters),
      inputTokens: numberOrUndefined(usageSource.input_tokens),
      outputTokens: numberOrUndefined(usageSource.output_tokens),
      totalTokens: numberOrUndefined(usageSource.total_tokens),
    },
  }
}

/**
 * Perform one non-streaming synthesis request. Exactly one HTTP request is
 * sent; failures and cancellations are never retried here because the provider
 * may bill a completed synthesis.
 * @param request - validated configuration, text, voice, and caller abort signal.
 * @returns the synthesized audio with request identifier, expiry, and usage.
 * @throws {@link BailianError} on network failure, non-2xx status, or contract violation.
 * @throws the caller's abort reason when `signal` aborts before or during the request.
 */
export async function synthesizeSpeech(request: SynthesizeSpeechRequest): Promise<SynthesisResult> {
  request.signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(request.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        input: {
          text: request.text,
          voice: request.voice,
          format: OUTPUT_FORMAT,
          sample_rate: SAMPLE_RATE,
        },
      }),
      signal: request.signal,
    })
  } catch (error: unknown) {
    if (request.signal.aborted) throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new BailianError(`speech synthesis request failed: ${reason}`, { cause: error })
  }
  let payload: unknown = undefined
  try {
    payload = await response.json()
  } catch (error: unknown) {
    if (request.signal.aborted) throw error
    if (response.ok) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new BailianError(`invalid API response: body is not JSON (${reason})`)
    }
    // A non-JSON error body still yields the status-based failure below.
  }
  if (!response.ok) throw responseError(response.status, payload)
  return validateResponse(payload)
}
