import type { EmbedInputPressure } from '@/hooks/use-embed-input-pressure'

export type CounterLabelKey =
  | 'embedder:inputWindow.count'
  | 'embedder:inputWindow.countApprox'
  | 'embedder:inputWindow.over'
  | 'embedder:inputWindow.overApprox'
  | 'embedder:inputWindow.queryOver'
  | 'embedder:inputWindow.queryOverApprox'

/**
 * What the text is to the embedder, which decides what overrunning costs.
 *
 * `document` is stored: the tail is absent from a vector that `source_hash` still
 * reads as fresh, so it stays unretrievable until the text changes. `query` is
 * transient — an over-long user action searches memory on its prefix and the next
 * turn asks again, so the copy says "searches" rather than "is searchable".
 */
export type CounterVariant = 'document' | 'query'

export type CounterLabel = { key: CounterLabelKey; values: { tokens: number; window: number } }

/**
 * Which counter string to show, or `null` when there is nothing honest to say —
 * no count yet, or no window to measure against.
 *
 * Returns the key rather than the rendered string so the choice can be pinned
 * without standing up i18n. The `Approx` variants exist because a provider has no
 * tokenizer to load: its number is an estimate against a guessed ceiling, and
 * rendering that identically to an exact local count would launder a guess.
 */
export function counterLabel(
  measured: EmbedInputPressure,
  variant: CounterVariant = 'document',
): CounterLabel | null {
  const { tokens, exact, window, pressure } = measured
  if (tokens === null || window.tokens === null) return null
  const values = { tokens, window: window.tokens }
  if (pressure === 'over') {
    if (variant === 'query') {
      return {
        key: exact ? 'embedder:inputWindow.queryOver' : 'embedder:inputWindow.queryOverApprox',
        values,
      }
    }
    return { key: exact ? 'embedder:inputWindow.over' : 'embedder:inputWindow.overApprox', values }
  }
  return { key: exact ? 'embedder:inputWindow.count' : 'embedder:inputWindow.countApprox', values }
}
