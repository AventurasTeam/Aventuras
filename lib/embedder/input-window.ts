import { localModelMaxInputTokens } from './catalog'
import type { EmbedderConfig } from './types'

/**
 * What to assume a provider's embedding endpoint accepts — nothing in the
 * OpenAI-compatible surface publishes it, so this is a guess. 8192 matches the
 * dominant hosted models and keeps the warning quiet for people who cannot act on
 * it; a self-hosted 512-token model is the case the configurable limit exists to fix.
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
 * `unknown` is a real outcome, not a fallback to some number: a custom import carries
 * no catalog row, and inventing a ceiling would warn against a limit nobody set. The
 * embed path still reports what it truncated, so a null costs detection, not truth.
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

/**
 * How close a text is to its embedder's ceiling. `over` means the tail will be
 * dropped at embed time — silently, and permanently while the text is unchanged.
 */
export type InputPressure = 'ok' | 'near' | 'over'

/**
 * Where the counter starts showing. Most entries sit far under the window, so a
 * permanently visible count would be noise on every multiline field in the app.
 */
export const NEAR_WINDOW_FRACTION = 0.75

/**
 * `ok` for an unknown window: a custom import sets no ceiling, and warning against one
 * nobody established is worse than silence — the embed still reports a real cut.
 */
export function inputPressure(tokens: number, window: InputWindow): InputPressure {
  if (window.tokens === null) return 'ok'
  if (tokens > window.tokens) return 'over'
  return tokens >= window.tokens * NEAR_WINDOW_FRACTION ? 'near' : 'ok'
}
