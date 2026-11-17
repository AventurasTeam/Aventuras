import type { LanguageModelUsage } from 'ai'

import type { ProviderInstance, TokenCounts } from '../db'

/** A call's counts as the provider reported them, as an entry stores them. */
export type TokenFigures = TokenCounts

// `raw` is the provider's own usage block. The SDK's usage reads a figure the server didn't send as
// 0, so only a number found here counts as reported.
function numberIn(raw: unknown, ...path: string[]): number | undefined {
  let value = raw
  for (const key of path) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function present<K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>)
}

/**
 * The prompt and reply counts, with reasoning and cache figures only when the provider sent them
 * (data-model.md → Entry metadata shape). Undefined when the call reported no counts at all.
 */
export function tokenFiguresOf(
  usage: LanguageModelUsage | undefined,
  providerType: ProviderInstance['type'],
): TokenFigures | undefined {
  // The SDK hands over a usage object of undefined fields when a stream reports none.
  if (usage?.inputTokens == null && usage?.outputTokens == null) return undefined
  const counts = { prompt: usage.inputTokens ?? 0, completion: usage.outputTokens ?? 0 }
  const { raw } = usage
  switch (providerType) {
    case 'openai-compatible':
      return {
        ...counts,
        ...present('reasoning', numberIn(raw, 'completion_tokens_details', 'reasoning_tokens')),
        ...present('cacheRead', numberIn(raw, 'prompt_tokens_details', 'cached_tokens')),
      }
    case 'anthropic':
      return {
        ...counts,
        ...present('cacheRead', numberIn(raw, 'cache_read_input_tokens')),
        ...present('cacheWrite', numberIn(raw, 'cache_creation_input_tokens')),
      }
    default:
      return counts
  }
}
