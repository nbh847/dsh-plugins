/** SenseNova U1.5 Lite synchronous image generation client. */

/** Official synchronous image generation endpoint path. */
const GENERATIONS_PATH = '/v1/images/generations'

/** One generated image as returned by the official API (24-hour temporary URL). */
export interface GenerationResult {
  /** Unix timestamp of the generation, as reported by the API. */
  created: number | undefined
  /** Temporary download URL; expires after 24 hours. */
  url: string
  /** Actual generated resolution, e.g. `2048x2048`, when the API reports it. */
  size: string | undefined
  /** Token usage reported by the API. */
  usage:
    | {
        inputTokens: number | undefined
        outputTokens: number | undefined
        totalTokens: number | undefined
        imagesCount: number | undefined
      }
    | undefined
}

/** Normalized API failure; messages carry the status and API code, never credentials. */
export class SensenovaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SensenovaError'
  }
}

/** Request for one synchronous generation. */
export interface GenerateImageRequest {
  apiKey: string
  baseUrl: string
  model: string
  prompt: string
  /** Optional official `size` value; forwarded without reinterpretation. */
  size?: string
  /** Logo watermark switch; defaults to false (clean image). */
  watermark: boolean
  /** Caller-owned abort signal (tool cancellation and timeout deadline). */
  signal: AbortSignal
}

/** Extract a safe message from an API error payload without leaking request data. */
function apiMessage(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const error = (payload as { error?: unknown }).error
  const source = typeof error === 'object' && error !== null ? error : payload
  const record = source as { message?: unknown; code?: unknown }
  const message = typeof record.message === 'string' ? record.message : undefined
  const code = typeof record.code === 'string' || typeof record.code === 'number'
    ? String(record.code)
    : undefined
  if (message !== undefined && code !== undefined) return `${code} ${message}`
  return message ?? code
}

/** Build the normalized failure for a non-2xx response. */
function responseError(status: number, payload: unknown): SensenovaError {
  const detail = apiMessage(payload)
  const label = status === 401 || status === 403
    ? 'authentication failed; check SENSENOVA_API_KEY'
    : status === 429
      ? 'rate limited by SenseNova; retry later'
      : `SenseNova API error (HTTP ${status})`
  return new SensenovaError(detail === undefined ? label : `${label}: ${detail}`)
}

/** Validate the success payload against the official response contract. */
function validateResponse(payload: unknown): GenerationResult {
  if (typeof payload !== 'object' || payload === null) {
    throw new SensenovaError('invalid API response: expected a JSON object')
  }
  const record = payload as { created?: unknown; data?: unknown; size?: unknown; usage?: unknown }
  if (!Array.isArray(record.data) || record.data.length === 0) {
    throw new SensenovaError('invalid API response: data[] is missing or empty')
  }
  const first = record.data[0] as { url?: unknown } | undefined
  if (typeof first?.url !== 'string' || first.url === '') {
    throw new SensenovaError('invalid API response: data[0].url is missing')
  }
  const usageSource = (typeof record.usage === 'object' && record.usage !== null ? record.usage : {}) as {
    input_tokens?: unknown
    output_tokens?: unknown
    total_tokens?: unknown
    images_count?: unknown
  }
  const numberOrUndefined = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  return {
    created: numberOrUndefined(record.created),
    url: first.url,
    size: typeof record.size === 'string' ? record.size : undefined,
    usage: {
      inputTokens: numberOrUndefined(usageSource.input_tokens),
      outputTokens: numberOrUndefined(usageSource.output_tokens),
      totalTokens: numberOrUndefined(usageSource.total_tokens),
      imagesCount: numberOrUndefined(usageSource.images_count),
    },
  }
}

/**
 * Perform one synchronous image generation request. Exactly one HTTP request is
 * sent; failures and cancellations are never retried here because the provider
 * may bill a completed generation.
 * @param request - validated configuration, prompt, and caller abort signal.
 * @returns the generated image with reported usage.
 * @throws {@link SensenovaError} on network failure, non-2xx status, or contract violation.
 * @throws the caller's abort reason when `signal` aborts before or during the request.
 */
export async function generateImage(request: GenerateImageRequest): Promise<GenerationResult> {
  request.signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(`${request.baseUrl}${GENERATIONS_PATH}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        response_format: 'url',
        watermark: request.watermark,
        ...(request.size === undefined ? {} : { size: request.size }),
      }),
      signal: request.signal,
    })
  } catch (error: unknown) {
    if (request.signal.aborted) throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new SensenovaError(`image generation request failed: ${reason}`, { cause: error })
  }
  let payload: unknown = undefined
  try {
    payload = await response.json()
  } catch (error: unknown) {
    if (request.signal.aborted) throw error
    if (response.ok) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new SensenovaError(`invalid API response: body is not JSON (${reason})`)
    }
    // A non-JSON error body still yields the status-based failure below.
  }
  if (!response.ok) throw responseError(response.status, payload)
  return validateResponse(payload)
}
