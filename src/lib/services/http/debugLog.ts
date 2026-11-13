// Debug-log helpers for HTTP requests: what a request entry shows and how a response is written.

import { isAbortError } from '#lib/services/activity/index.ts'
import { debugLog } from '#lib/stores/debugLog.ts'
import { errMessage } from '#lib/utils/error.ts'

const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'api-key', 'x-goog-api-key'])
const BINARY_CONTENT_TYPE = /^(image|audio|video)\/|octet-stream/
const SCRUB_MIN_LENGTH = 1024
const BASE64_BODY = /^[A-Za-z0-9+/_-]+={0,2}$/

/** The request entry a response is written against. */
export interface DebugEntry {
  debugId: string
  serviceId: string
  startTime: number
}

/** Writes a response's entry. Reads only a clone, so the caller still gets the whole body. */
export type ResponseLogger = (response: Response, entry: DebugEntry) => void

// Not `new Headers(init)`: it lowercases names, and the panel shows them as sent.
export function headerEntries(headers: HeadersInit | undefined): Iterable<[string, string]> {
  if (!headers) return []
  if (headers instanceof Headers || Array.isArray(headers)) return headers
  return Object.entries(headers)
}

export function redactHeaders(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(
    Array.from(headerEntries(headers), ([key, value]) => [
      key,
      SENSITIVE_HEADERS.has(key.toLowerCase()) && value.length > 8
        ? value.slice(0, 4) + '...' + value.slice(-4)
        : value,
    ]),
  )
}

export function isBinaryContentType(contentType: string): boolean {
  return BINARY_CONTENT_TYPE.test(contentType)
}

/** Replaces a large `data:` URI or bare base64 string, so the payload stays small enough to show. */
export function scrubBase64(value: unknown): unknown {
  return typeof value === 'string' &&
    value.length >= SCRUB_MIN_LENGTH &&
    (value.startsWith('data:') || BASE64_BODY.test(value))
    ? `[base64, ${value.length} chars]`
    : value
}

/** JSON with its base64 scrubbed, or the scrubbed text when it is not JSON. */
export function parseLoggedBody(text: string): unknown {
  try {
    return JSON.parse(text, (_key, value) => scrubBase64(value))
  } catch {
    return scrubBase64(text)
  }
}

/** Every value is a string or a file; repeated keys (several reference images) stay an array. */
function describeFormData(form: FormData): Record<string, unknown> {
  const fields = new Map<string, unknown[]>()
  for (const [key, value] of form) {
    const shown =
      typeof value === 'string'
        ? scrubBase64(value)
        : `[file ${value.name}, ${value.type || 'unknown type'}, ${value.size} bytes]`
    fields.set(key, [...(fields.get(key) ?? []), shown])
  }
  return Object.fromEntries(
    Array.from(fields, ([key, values]) => [key, values.length === 1 ? values[0] : values]),
  )
}

export function describeRequestBody(body: RequestInit['body']): unknown {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body, (_key, value) => scrubBase64(value))
    } catch {
      return { raw: body.slice(0, 200) }
    }
  }
  if (body instanceof FormData) return { formData: describeFormData(body) }
  return undefined
}

export function failureReason(error: unknown): string {
  return isAbortError(error) ? 'aborted' : errMessage(error)
}

/** What a body read produced: the text that arrived, whether or not the read finished. */
export type BodyRead = { text: string; bytes: number } & (
  { ok: true } | { ok: false; error: unknown }
)

export type FailedRead = Extract<BodyRead, { ok: false }>

/** Never throws: a body that fails partway returns the text decoded so far, with the error. */
export async function readLoggedBody(response: Response): Promise<BodyRead> {
  const reader = response.body?.getReader()
  if (!reader) return { ok: true, text: '', bytes: 0 }
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
    return { ok: true, text: text + decoder.decode(), bytes }
  } catch (error) {
    return { ok: false, text: text + decoder.decode(), bytes, error }
  }
}

/** Why a body stopped and how far it got. */
export function describeReadFailure(read: FailedRead): string {
  const reason = failureReason(read.error)
  return read.bytes === 0
    ? `${reason} (headers received, no body yet)`
    : `${reason} (${read.bytes} bytes received)`
}

/** For a body that failed while being read: the status it arrived with, why it stopped, and what came before. */
export function logReadFailure(response: Response, entry: DebugEntry, read: FailedRead): void {
  debugLog.addResponse(
    entry.debugId,
    entry.serviceId,
    {
      status: response.status,
      error: describeReadFailure(read),
      received: {
        bytes: read.bytes,
        ...(read.bytes > 0 && { body: parseLoggedBody(read.text) }),
      },
    },
    entry.startTime,
    describeReadFailure(read),
  )
}

export async function logErrorResponse(response: Response, entry: DebugEntry): Promise<void> {
  const { debugId, serviceId, startTime } = entry
  const read = await readLoggedBody(response)
  if (!read.ok) {
    logReadFailure(response, entry, read)
    return
  }
  debugLog.addResponse(
    debugId,
    serviceId,
    {
      status: response.status,
      statusText: response.statusText,
      error: parseLoggedBody(read.text),
    },
    startTime,
    read.text,
  )
}

/** `describe` adds fields derived from the parsed body, for callers that know its shape. */
export async function logJsonResponse(
  response: Response,
  entry: DebugEntry,
  describe?: (body: unknown) => Record<string, unknown>,
): Promise<void> {
  const { debugId, serviceId, startTime } = entry
  const read = await readLoggedBody(response)
  if (!read.ok) {
    logReadFailure(response, entry, read)
    return
  }
  const body = parseLoggedBody(read.text)
  debugLog.addResponse(
    debugId,
    serviceId,
    { status: response.status, body, ...describe?.(body) },
    startTime,
  )
}

/** Logs the type and size without reading the body. */
export function logBinaryResponse(response: Response, entry: DebugEntry): void {
  const length = response.headers.get('content-length')
  debugLog.addResponse(
    entry.debugId,
    entry.serviceId,
    {
      status: response.status,
      contentType: response.headers.get('content-type'),
      size: length === null ? undefined : Number(length),
    },
    entry.startTime,
  )
}

/** For a body the caller will cancel, which a live clone would keep open. */
export function logStatus(response: Response, entry: DebugEntry): void {
  debugLog.addResponse(entry.debugId, entry.serviceId, { status: response.status }, entry.startTime)
}

/** An untyped response is treated as binary: unknown bytes are never read as text. */
const logUntypedOrText: ResponseLogger = (response, entry) => {
  if (response.headers.get('content-type')) void logJsonResponse(response.clone(), entry)
  else logBinaryResponse(response, entry)
}

interface ResponseLoggerOptions {
  describeJson?: (body: unknown) => Record<string, unknown>
  /** Logs a success that is neither binary nor JSON. */
  logOther?: ResponseLogger
}

export function createResponseLogger(options: ResponseLoggerOptions = {}): ResponseLogger {
  const { describeJson, logOther = logUntypedOrText } = options
  return (response, entry) => {
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok) {
      void logErrorResponse(response.clone(), entry)
    } else if (isBinaryContentType(contentType)) {
      logBinaryResponse(response, entry)
    } else if (contentType.includes('json')) {
      void logJsonResponse(response.clone(), entry, describeJson)
    } else {
      logOther(response, entry)
    }
  }
}

export const logResponse = createResponseLogger()
