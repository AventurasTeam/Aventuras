import type { EmbedInputPressure } from '@/hooks/use-embed-input-pressure'

export type CounterLabelKey =
  | 'embedder:inputWindow.count'
  | 'embedder:inputWindow.countApprox'
  | 'embedder:inputWindow.over'
  | 'embedder:inputWindow.overApprox'

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
export function counterLabel(measured: EmbedInputPressure): CounterLabel | null {
  const { tokens, exact, window, pressure } = measured
  if (tokens === null || window.tokens === null) return null
  const values = { tokens, window: window.tokens }
  if (pressure === 'over') {
    return { key: exact ? 'embedder:inputWindow.over' : 'embedder:inputWindow.overApprox', values }
  }
  return { key: exact ? 'embedder:inputWindow.count' : 'embedder:inputWindow.countApprox', values }
}
