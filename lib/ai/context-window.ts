import type { LanguageModelMiddleware } from 'ai'

import { logger } from '@/lib/diagnostics'
import { countTokens } from '@/lib/retrieval'

import type { ProviderInstance } from '../db'
import { resolveModelCapabilities } from './model-capabilities'
import type { ModelPrompt, ModelTools } from './prompt-schema'
import { recognizeOverflow } from './transport/classify-provider-error'

export type GenerationWindow =
  | { tokens: number; source: 'configured' | 'detected' }
  | { tokens: null; source: 'unknown' }

type FailureWindow =
  | { window: number; windowSource: 'configured' | 'detected' }
  | {
      /** Null when unknown, which only a provider rejection can report. */
      window: null
      windowSource: 'unknown'
    }

/** generation-pipeline.md → Two retry tiers. */
export type ContextWindowFailure = {
  /** The pre-send check, or a recognized provider rejection. */
  detectedBy: 'check' | 'provider'
  /** countTokens over the request as sent. */
  estimate: number
  providerId: string
  modelId: string
  /** The provider's message verbatim; provider-detected only. */
  detail?: string
} & FailureWindow

function failureWindow(window: GenerationWindow): FailureWindow {
  return window.source === 'unknown'
    ? { window: null, windowSource: 'unknown' }
    : { window: window.tokens, windowSource: window.source }
}

/** architecture.md → The window figure: configured, else detected, else unknown; never assumed. */
export function generationWindow(
  providers: readonly ProviderInstance[],
  providerId: string,
  modelId: string,
): GenerationWindow {
  const overrides = providers.find((p) => p.id === providerId)?.contextWindowOverrides
  // hasOwn: a model id such as `constructor` must not read Object.prototype.
  if (overrides !== undefined && Object.hasOwn(overrides, modelId)) {
    return { tokens: overrides[modelId], source: 'configured' }
  }
  const detected = resolveModelCapabilities(providerId, modelId, providers)?.contextWindow
  if (detected !== undefined) return { tokens: detected, source: 'detected' }
  return { tokens: null, source: 'unknown' }
}

/** The check's refusal, or a recognized overflow; callWithRetry returns its failure at once. */
export class ContextWindowError extends Error {
  readonly failure: ContextWindowFailure
  constructor(failure: ContextWindowFailure) {
    super(describeContextWindow(failure))
    this.name = 'ContextWindowError'
    this.failure = failure
  }
}

/** One English line for logs and failure details. */
export function describeContextWindow(failure: ContextWindowFailure): string {
  const { detectedBy, estimate, window, windowSource, providerId, modelId, detail } = failure
  const windowPart = window !== null ? `, window ${window} (${windowSource})` : ''
  const detailPart = detail?.trim() ? `: ${detail}` : ''
  return (
    `prompt over the context window (${detectedBy}): estimate ${estimate} tokens${windowPart}; ` +
    `model ${modelId} on provider ${providerId}${detailPart}`
  )
}

/** The most texts the count cache holds. */
export const PROMPT_COUNT_CACHE_ENTRIES = 4096
/** The most characters the count cache holds across its texts. */
export const PROMPT_COUNT_CACHE_CHARS = 2_000_000

// A close task's steps recount the same texts, led by a chapter-long system half that a plain LRU
// would evict first once a pass overflows; the pass pins its system half and the budget is
// characters. A Map iterates in insertion order, so re-setting an entry keeps the oldest first.
const promptCounts = new Map<string, number>()
let cachedChars = 0
let pinned: string | null = null

function forget(text: string): void {
  if (promptCounts.delete(text)) cachedChars -= text.length
}

function remember(text: string, tokens: number): void {
  forget(text)
  if (text.length > PROMPT_COUNT_CACHE_CHARS) {
    logger.debug('provider.prompt_count_uncached', {
      chars: text.length,
      budget: PROMPT_COUNT_CACHE_CHARS,
    })
    return
  }
  promptCounts.set(text, tokens)
  cachedChars += text.length
  for (const oldest of promptCounts.keys()) {
    if (promptCounts.size <= PROMPT_COUNT_CACHE_ENTRIES && cachedChars <= PROMPT_COUNT_CACHE_CHARS)
      break
    if (oldest !== pinned) forget(oldest)
  }
}

function countOnce(text: string): number {
  const tokens = promptCounts.get(text) ?? countTokens(text)
  remember(text, tokens)
  return tokens
}

/** Records a text's count without encoding it. `tokens` must be the count of exactly this text:
 *  the pre-send check trusts it. */
export function primePromptCount(text: string, tokens: number): void {
  remember(text, tokens)
}

/** Test seam: empties the count cache. */
export function __clearPromptCountCache(): void {
  promptCounts.clear()
  cachedChars = 0
}

/** countTokens over the request as sent: system content; text and reasoning parts; each tool
 *  call's name and input; each tool result's name and output; each tool definition as JSON. Each
 *  text is counted through the count cache, the system half pinned while the pass runs. */
export function countPromptTokens(prompt: ModelPrompt, tools?: ModelTools): number {
  pinned = prompt.find((message) => message.role === 'system')?.content ?? null
  try {
    let total = 0
    for (const message of prompt) {
      if (message.role === 'system') total += countOnce(message.content)
      else for (const part of message.content) total += countPartTokens(part)
    }
    for (const tool of tools ?? []) total += countOnce(JSON.stringify(tool))
    return total
  } finally {
    pinned = null
  }
}

type PromptPart = Exclude<ModelPrompt[number], { role: 'system' }>['content'][number]
type ToolResultOutput = Extract<PromptPart, { type: 'tool-result' }>['output']

function countPartTokens(part: PromptPart): number {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return countOnce(part.text)
    case 'tool-call':
      return countOnce(part.toolName) + countOnce(JSON.stringify(part.input) ?? '')
    case 'tool-result':
      return countOnce(part.toolName) + countOnce(outputText(part.output))
    case 'file':
    case 'tool-approval-response':
      return 0
    default: {
      const unreachable: never = part
      return unreachable
    }
  }
}

// As the adapters send each arm: text raw, json stringified (a string value too), a denial as its
// reason or a default; `content` is JSON on openai-compatible, an estimate of Anthropic's blocks.
function outputText(output: ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value
    case 'json':
    case 'error-json':
    case 'content':
      return JSON.stringify(output.value) ?? ''
    case 'execution-denied':
      return output.reason ?? 'Tool execution denied.'
    default: {
      const unreachable: never = output
      return unreachable
    }
  }
}

/**
 * Counts the prompt as sent and refuses one over a known window (architecture.md → The pre-send
 * check), then reads a recognized overflow rejection as a provider-detected failure. Must run last
 * in its chain, so the count includes an injected JSON contract.
 */
export function windowCheckMiddleware(opts: {
  window: GenerationWindow
  providerId: string
  modelId: string
  /** Receives the request's estimate before the comparison, on every attempt. */
  onEstimate: (estimate: number) => void
  /** The run's action, attributing the debug log; absent outside a run. */
  actionId?: string
}): LanguageModelMiddleware {
  const { window, providerId, modelId, onEstimate, actionId } = opts
  const checked = async <R>(
    prompt: ModelPrompt,
    tools: ModelTools,
    send: () => PromiseLike<R>,
  ): Promise<R> => {
    const startedAt = performance.now()
    const estimate = countPromptTokens(prompt, tools)
    const ms = Math.round(performance.now() - startedAt)
    onEstimate(estimate)
    logger.debug(
      'provider.prompt_estimate',
      {
        providerId,
        modelId,
        estimate,
        window: window.tokens,
        windowSource: window.source,
        ms,
      },
      actionId === undefined ? undefined : { actionId },
    )
    // Strictly over, with no reply reserve and no margin: architecture.md → The pre-send check.
    if (window.tokens !== null && estimate > window.tokens) {
      throw new ContextWindowError({
        detectedBy: 'check',
        estimate,
        ...failureWindow(window),
        providerId,
        modelId,
      })
    }
    try {
      return await send()
    } catch (error) {
      const overflow = recognizeOverflow(error)
      if (overflow === null) throw error
      // architecture.md → Recognizing an overflow rejection: the provider's message verbatim.
      throw new ContextWindowError({
        detectedBy: 'provider',
        estimate,
        ...failureWindow(window),
        providerId,
        modelId,
        detail: overflow.detail,
      })
    }
  }
  return {
    specificationVersion: 'v3',
    wrapGenerate: ({ params, doGenerate }) => checked(params.prompt, params.tools, doGenerate),
    wrapStream: ({ params, doStream }) => checked(params.prompt, params.tools, doStream),
  }
}

/** Exact under 1,000, else ceil to the next 100, so a refused estimate stays over its window. */
export function displayEstimate(tokens: number): number {
  return tokens < 1000 ? tokens : Math.ceil(tokens / 100) * 100
}
