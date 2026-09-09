import { localModelMaxInputTokens } from './catalog'
import type { EmbedderConfig } from './types'

/**
 * What to assume a provider's embedding endpoint accepts, absent anything better.
 *
 * Nothing in the OpenAI-compatible surface publishes this: `/v1/models` carries
 * id, object, created and owned_by, and `usage.prompt_tokens` reports what a
 * successful call spent rather than the ceiling. So this is a guess, and the
 * direction of the guess is a choice — 8192 matches the dominant hosted models
 * (OpenAI's text-embedding-3 family, Nomic, Jina) and keeps the warning quiet for
 * the people who cannot act on it. A self-hosted 512-token model is the case this
 * gets wrong, and the case the configurable limit exists to fix.
 */
export const ASSUMED_PROVIDER_MAX_INPUT_TOKENS = 8192

/**
 * Where a window came from. `assumed` is the one a surface must not present as
 * fact: it is this module's guess, not the endpoint's answer.
 */
export type InputWindowSource = 'catalog' | 'configured' | 'assumed' | 'unknown'

export type InputWindow = { tokens: number | null; source: InputWindowSource }

/**
 * The input window to hold text against, and how much the answer is worth.
 *
 * `unknown` is a real outcome rather than a fallback to some number: a custom
 * imported model carries no catalog row, and inventing a ceiling for it would
 * warn against a limit nobody established. The embed path reports what it
 * actually truncated regardless, so a null here costs detection, not truth.
 */
export function embedderInputWindow(
  config: EmbedderConfig,
  capabilities?: { maxInputTokens?: number },
): InputWindow {
  if (config.backend === 'local') {
    const catalogued = localModelMaxInputTokens(config.modelId)
    return catalogued === undefined
      ? { tokens: null, source: 'unknown' }
      : { tokens: catalogued, source: 'catalog' }
  }
  const configured = capabilities?.maxInputTokens
  return configured === undefined
    ? { tokens: ASSUMED_PROVIDER_MAX_INPUT_TOKENS, source: 'assumed' }
    : { tokens: configured, source: 'configured' }
}
