import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

type SwapDialogState = { storyId: string } | null

/**
 * `cancelRequested` lives INSIDE the progress slot, not beside it: a cancel is
 * only meaningful against a staging loop that is actually running, so clearing
 * progress must clear the flag. Held as a sibling it outlived its run and armed
 * the next swap's first batch poll, which cost two separate fixes and a reset
 * inside `openEmbedderSwapDialog` before the shape was the thing that changed.
 */
type SwapProgress = { storyId: string; done: number; total: number; cancelRequested: boolean }

type EmbedderSwapState = {
  dialog: SwapDialogState
  progress: SwapProgress | null
  /**
   * Story whose resume prompt the user deferred with "Later". A single slot, not
   * a set: one story is in view at a time, so deferring another simply replaces
   * this one — no id can linger to suppress a prompt for a story the user came
   * back to. The marker survives regardless; deferring hides the modal, not the
   * condition.
   */
  resumeDeferredFor: string | null
}

const INITIAL: EmbedderSwapState = { dialog: null, progress: null, resumeDeferredFor: null }

const store = createStore<EmbedderSwapState>()(() => INITIAL)

/**
 * C8 (milestone 3 slice contract): the single named action that opens the
 * model-swap dialog for a story. 3.4's sync-failure surface imports this —
 * the name is fixed; renaming is a cross-slice break.
 */
export function openEmbedderSwapDialog(storyId: string): void {
  store.setState({ dialog: { storyId } })
}

export const embedderSwapStore = {
  useSwap: <T>(selector: (s: EmbedderSwapState) => T): T => useStore(store, selector),
  getState: (): EmbedderSwapState => store.getState(),
  closeDialog: (): void => store.setState({ dialog: null }),
  /** Opens a fresh run's progress slot — necessarily un-cancelled. */
  beginProgress: (storyId: string): void =>
    store.setState({ progress: { storyId, done: 0, total: 0, cancelRequested: false } }),
  /** Per-batch counts. Preserves a cancel already requested against this run. */
  setProgress: ({ storyId, done, total }: Omit<SwapProgress, 'cancelRequested'>): void =>
    store.setState((s) => ({
      progress: { storyId, done, total, cancelRequested: s.progress?.cancelRequested ?? false },
    })),
  clearProgress: (): void => store.setState({ progress: null }),
  /** No-op with no run in flight — there is nothing to cancel, and nothing to leak. */
  requestCancel: (): void =>
    store.setState((s) => ({ progress: s.progress && { ...s.progress, cancelRequested: true } })),
  isCancelRequested: (): boolean => store.getState().progress?.cancelRequested ?? false,
  deferResume: (storyId: string): void => store.setState({ resumeDeferredFor: storyId }),
  /** Cleared on resume/cancel so a later interruption prompts again. */
  clearDeferredResume: (): void => store.setState({ resumeDeferredFor: null }),
  __reset: (): void => store.setState(INITIAL),
}

export type { SwapProgress }
