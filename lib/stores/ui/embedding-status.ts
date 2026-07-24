import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

type EmbeddingStatusState = { storyId: string | null; staleTotal: number }

const INITIAL: EmbeddingStatusState = { storyId: null, staleTotal: 0 }

const store = createStore<EmbeddingStatusState>()(() => INITIAL)

export const embeddingStatusStore = {
  useEmbeddingStatus: <T>(selector: (s: EmbeddingStatusState) => T): T => useStore(store, selector),
  getState: (): EmbeddingStatusState => store.getState(),
  setStatus: (storyId: string, staleTotal: number): void => store.setState({ storyId, staleTotal }),
  clear: (): void => store.setState(INITIAL),
  __reset: (): void => store.setState(INITIAL),
}

export type { EmbeddingStatusState }
