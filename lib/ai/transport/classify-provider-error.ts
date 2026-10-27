import { APICallError } from 'ai'

import type { ContextWindowFailure } from '../context-window'
import type { ReplyCutOffFailure } from '../reply-cut-off'

// lib/ai-local error vocabulary. The pipeline layer maps these to PipelineError
// when it yields recoverable_error events — keeps lib/ai free of an upward
// lib/pipeline type dependency.
export type CallRetryError =
  | {
      tier: 'provider'
      reason: 'auth' | 'network' | 'timeout' | 'unknown'
      detail?: string
      possibleCapabilityMismatch?: CapabilityHint
    }
  | { tier: 'parse'; detail: string; attempt: number }
  | ({ tier: 'context-window' } & ContextWindowFailure)
  | ({ tier: 'reply-cut-off' } & ReplyCutOffFailure)

// Thrown by a callFn when its own per-attempt timeout fires (so callWithRetry
// classifies it as a retryable provider timeout, not a user-cancel abort).
export class ProviderTimeoutError extends Error {
  constructor(message = 'provider call timed out') {
    super(message)
    this.name = 'ProviderTimeoutError'
  }
}

const MAX_CAUSE_DEPTH = 5

// A thrown value need not be coercible: `String()` on a null-prototype object
// throws, which would replace the provider failure with a TypeError.
function coerce(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '[uncoercible value]'
  }
}

function labelOf(error: unknown): string {
  if (!(error instanceof Error)) return coerce(error)
  // The AI SDK stamps every error name with an `AI_` prefix; it carries no
  // information the surrounding log line doesn't already have.
  const name = error.name.replace(/^AI_/, '')
  const { message } = error
  if (message.length === 0) return name
  return name.length > 0 && name !== 'Error' && !message.startsWith(name)
    ? `${name}: ${message}`
    : message
}

/**
 * Flattens an error's `cause` chain into one line, root-most link last.
 *
 * The AI SDK wraps anything its response handler throws in an `APICallError`
 * whose own message names only the envelope ("Failed to process successful
 * response"); the actual failure — empty body, schema mismatch — is a `cause`
 * link down. A bare `.message` therefore reports nothing actionable.
 */
export function describeProviderError(error: unknown): string {
  const links: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
    const label = labelOf(current)
    if (links.at(-1) !== label) links.push(label)
    current = current instanceof Error ? current.cause : undefined
  }
  return links.join(' ← ')
}

function parseRetryAfter(headers: Record<string, string> | undefined): number | undefined {
  if (headers === undefined) return undefined
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'retry-after')
  const raw = key ? headers[key] : undefined
  if (raw === undefined) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const dateMs = Date.parse(raw)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  return undefined
}

const OVERFLOW_CODES = ['context_length_exceeded', 'exceed_context_size_error'] as const

const OVERFLOW_KEYWORDS = [
  'maximum context length',
  'context size',
  'context window',
  'prompt is too long',
  'input token count',
  'max_new_tokens must be',
] as const

// Parameter names before generic words, so "json_schema not supported for reasoning models"
// points at structured output.
const CAPABILITY_HINT_KEYWORDS = [
  { matched: 'response_format', capability: 'structuredOutput' },
  { matched: 'json_schema', capability: 'structuredOutput' },
  { matched: 'budget_tokens', capability: 'reasoning' },
  { matched: 'thinking', capability: 'reasoning' },
  { matched: 'reasoning', capability: 'reasoning' },
] as const satisfies readonly { matched: string; capability: 'reasoning' | 'structuredOutput' }[]

/**
 * generation-pipeline.md → Fatal error categories: a best-effort hint, never an assertion.
 * `matched` is the keyword that matched, for the copy.
 */
export type CapabilityHint = (typeof CAPABILITY_HINT_KEYWORDS)[number]

// A 2xx APICallError is a successful reply the SDK couldn't read: its body is the model's own text.
function isRejection(error: unknown): error is APICallError & { statusCode: number } {
  return APICallError.isInstance(error) && error.statusCode !== undefined && error.statusCode >= 400
}

function bodyText(error: APICallError): string {
  const body = error.responseBody?.trim()
  return body !== undefined && body !== '' ? body : error.message
}

// Backticks dropped: TGI writes "`max_new_tokens` must be".
function searchableText(error: APICallError): string {
  return bodyText(error).toLowerCase().replace(/`/g, '')
}

// JSON.parse never yields undefined, so undefined means the text is not JSON.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function parsedBody(error: APICallError): unknown {
  const parsed = error.responseBody === undefined ? undefined : parseJson(error.responseBody)
  // Not JSON: what the SDK parsed, if anything, is all there is.
  return parsed === undefined ? error.data : parsed
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

// A blank string is no message: `error.message: ""` must fall through to the next candidate.
function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  return nonBlank(field(value, key))
}

// OpenAI's and llama.cpp's error.message, TGI's error string, vLLM's top-level message.
function messageOf(body: unknown): string | undefined {
  const inner = field(body, 'error')
  return stringField(inner, 'message') ?? nonBlank(inner) ?? stringField(body, 'message')
}

// OpenRouter's message for a provider's rejection is only "Provider returned error"; the
// provider's own body is error.metadata.raw, as JSON text, plain text or an object.
function upstreamMessage(body: unknown): string | undefined {
  const raw = field(field(field(body, 'error'), 'metadata'), 'raw')
  if (typeof raw !== 'string') return messageOf(raw)
  const text = raw.trim()
  return text === '' ? undefined : (messageOf(parseJson(text)) ?? text)
}

// The body itself last: the SDK's message for a body it couldn't parse is only the status text.
function providerMessage(error: APICallError, body: unknown): string {
  return upstreamMessage(body) ?? messageOf(body) ?? bodyText(error)
}

/** architecture.md → Recognizing an overflow rejection: by code, then keyword, on any 4xx/5xx. */
export function recognizeOverflow(error: unknown): { detail: string } | null {
  if (!isRejection(error)) return null
  const body = parsedBody(error)
  const inner = field(body, 'error')
  const codes = [stringField(inner, 'code'), stringField(inner, 'type'), stringField(body, 'code')]
  const byCode = codes.some(
    (code) => code !== undefined && (OVERFLOW_CODES as readonly string[]).includes(code),
  )
  if (!byCode) {
    const text = searchableText(error)
    if (!OVERFLOW_KEYWORDS.some((keyword) => text.includes(keyword))) return null
  }
  return { detail: providerMessage(error, body) }
}

/** A 4xx body naming a capability keyword; never on a body recognized as an overflow. */
export function capabilityHintOf(error: unknown): CapabilityHint | undefined {
  if (!isRejection(error) || error.statusCode >= 500) return undefined
  if (recognizeOverflow(error) !== null) return undefined
  const text = searchableText(error)
  const hit = CAPABILITY_HINT_KEYWORDS.find(({ matched }) => text.includes(matched))
  return hit === undefined ? undefined : { ...hit }
}

type ProviderFailure = Extract<CallRetryError, { tier: 'provider' }>

export function classifyProviderError(error: unknown): {
  error: ProviderFailure
  retryable: boolean
  retryAfterMs?: number
} {
  if (error instanceof ProviderTimeoutError) {
    return { error: { tier: 'provider', reason: 'timeout' }, retryable: true }
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    const retryAfterMs = parseRetryAfter(error.responseHeaders)
    const hint = capabilityHintOf(error)
    const failure = (reason: ProviderFailure['reason']): ProviderFailure => ({
      tier: 'provider',
      reason,
      detail: describeProviderError(error),
      ...(hint !== undefined ? { possibleCapabilityMismatch: hint } : {}),
    })
    // An overflow recurs on every attempt, whatever its status.
    const overflow = recognizeOverflow(error) !== null
    if (status === 401 || status === 403) {
      return { error: failure('auth'), retryable: false }
    }
    if (status === 429) {
      return {
        error: failure('network'),
        retryable: !overflow,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      }
    }
    if (status !== undefined && status >= 400 && status < 500) {
      return { error: failure('unknown'), retryable: false }
    }
    return {
      error: failure('network'),
      retryable: !overflow,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    }
  }
  return {
    error: {
      tier: 'provider',
      reason: 'unknown',
      detail: describeProviderError(error),
    },
    retryable: true,
  }
}
