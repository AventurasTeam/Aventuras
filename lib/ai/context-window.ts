import type { LanguageModelMiddleware } from 'ai'

import { logger } from '@/lib/diagnostics'
import { countTokens } from '@/lib/retrieval'

import type { ProviderInstance } from '../db'
import { resolveModelCapabilities } from './model-capabilities'
import type { ModelPrompt } from './prompt-schema'
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

/** countTokens over the system content and the text parts of user and assistant messages. */
export function countPromptTokens(prompt: ModelPrompt): number {
  let total = 0
  for (const message of prompt) {
    if (message.role === 'system') {
      total += countTokens(message.content)
    } else if (message.role === 'user' || message.role === 'assistant') {
      for (const part of message.content) {
        if (part.type === 'text') total += countTokens(part.text)
      }
    }
  }
  return total
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
  const checked = async <R>(prompt: ModelPrompt, send: () => PromiseLike<R>): Promise<R> => {
    const startedAt = performance.now()
    const estimate = countPromptTokens(prompt)
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
    wrapGenerate: ({ params, doGenerate }) => checked(params.prompt, doGenerate),
    wrapStream: ({ params, doStream }) => checked(params.prompt, doStream),
  }
}

/** Exact under 1,000, else ceil to the next 100, so a refused estimate stays over its window. */
export function displayEstimate(tokens: number): number {
  return tokens < 1000 ? tokens : Math.ceil(tokens / 100) * 100
}
