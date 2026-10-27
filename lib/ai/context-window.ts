import type { LanguageModelMiddleware } from 'ai'

import { logger } from '@/lib/diagnostics'
import { countTokens } from '@/lib/retrieval'

import type { ProviderInstance } from '../db'
import type { ModelPrompt } from './prompt-schema'

export type GenerationWindow =
  | { tokens: number; source: 'configured' | 'detected' }
  | { tokens: null; source: 'unknown' }
export type WindowSource = GenerationWindow['source']

/** generation-pipeline.md → Two retry tiers. */
export type ContextWindowFailure = {
  /** The pre-send check, or a recognized provider rejection. */
  detectedBy: 'check' | 'provider'
  /** countTokens over the request as sent. */
  estimate: number
  /** Null when unknown, which only a provider rejection can report. */
  window: number | null
  windowSource: WindowSource
  providerId: string
  modelId: string
  /** The provider's message verbatim; provider-detected only. */
  detail?: string
}

/** architecture.md → The window figure: configured, else detected, else unknown; never assumed. */
export function generationWindow(
  providers: readonly ProviderInstance[],
  providerId: string,
  modelId: string,
): GenerationWindow {
  const provider = providers.find((p) => p.id === providerId)
  const overrides = provider?.contextWindowOverrides
  // hasOwn: a model id such as `constructor` must not read Object.prototype.
  if (overrides !== undefined && Object.hasOwn(overrides, modelId)) {
    return { tokens: overrides[modelId], source: 'configured' }
  }
  const cached = provider?.cachedModels?.find((m) => m.id === modelId)
  const detected = cached?.capabilities?.contextWindow
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
  const detailPart = detail !== undefined ? `: ${detail}` : ''
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
 * Counts the request as sent and refuses one over a known window (architecture.md → The pre-send
 * check). Must run last in its chain, so the count includes an injected JSON contract.
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
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const startedAt = performance.now()
      const estimate = countPromptTokens(params.prompt)
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
          window: window.tokens,
          windowSource: window.source,
          providerId,
          modelId,
        })
      }
      return params
    },
  }
}

/** An estimate as copy prints it: exact under 1,000, else rounded up to the next 100, so a refused estimate never prints at or under its window. */
export function displayEstimate(tokens: number): number {
  return tokens < 1000 ? tokens : Math.ceil(tokens / 100) * 100
}
