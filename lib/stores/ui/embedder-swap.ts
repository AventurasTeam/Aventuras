import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

type SwapDialogState = { storyId: string } | null
type SwapProgress = { storyId: string; done: number; total: number } | null

type EmbedderSwapState = {
  dialog: SwapDialogState
  progress: SwapProgress
  cancelRequested: boolean
}

const INITIAL: EmbedderSwapState = { dialog: null, progress: null, cancelRequested: false }

const store = createStore<EmbedderSwapState>()(() => INITIAL)

/**
 * C8 (milestone 3 slice contract): the single named action that opens the
 * model-swap dialog for a story. 3.4's sync-failure surface imports this —
 * the name is fixed; renaming is a cross-slice break.
 */
export function openEmbedderSwapDialog(storyId: string): void {
  store.setState({ dialog: { storyId }, cancelRequested: false })
}

export const embedderSwapStore = {
  useSwap: <T>(selector: (s: EmbedderSwapState) => T): T => useStore(store, selector),
  getState: (): EmbedderSwapState => store.getState(),
  closeDialog: (): void => store.setState({ dialog: null }),
  setProgress: (progress: NonNullable<SwapProgress>): void => store.setState({ progress }),
  clearProgress: (): void => store.setState({ progress: null, cancelRequested: false }),
  requestCancel: (): void => store.setState({ cancelRequested: true }),
  __reset: (): void => store.setState(INITIAL),
}

export type { SwapProgress }
