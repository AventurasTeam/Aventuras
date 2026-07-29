import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/**
 * `staleTotal` only means anything alongside the story it was counted for, so
 * the pair is one nullable slot rather than two independent fields — a count
 * with no story attached is not a state any reader can act on.
 */
type EmbeddingStatus = { storyId: string; staleTotal: number }

type EmbeddingStatusState = { status: EmbeddingStatus | null }

const INITIAL: EmbeddingStatusState = { status: null }

const store = createStore<EmbeddingStatusState>()(() => INITIAL)

export const embeddingStatusStore = {
  useEmbeddingStatus: <T>(selector: (s: EmbeddingStatusState) => T): T => useStore(store, selector),
  getState: (): EmbeddingStatusState => store.getState(),
  setStatus: (storyId: string, staleTotal: number): void =>
    store.setState({ status: { storyId, staleTotal } }),
  /**
   * Stale rows for `storyId`, or 0 when the slot belongs to another story.
   * `null` (no story open yet) can never match, so it reads as 0 rather than
   * needing a separate guard at each call site.
   */
  staleTotalFor: (s: EmbeddingStatusState, storyId: string | null): number =>
    storyId != null && s.status?.storyId === storyId ? s.status.staleTotal : 0,
  __reset: (): void => store.setState(INITIAL),
}

export type { EmbeddingStatus, EmbeddingStatusState }
