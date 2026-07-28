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
  /**
   * Keyed by story because the swap lock is per-story (`runExclusive`), so two
   * stories can legitimately stage at once. Sharing one slot let a second story's
   * run clear the first's pending cancel and made every cancel read unscoped.
   */
  progress: Record<string, SwapProgress>
  /**
   * Story whose resume prompt the user deferred with "Later". A single slot, not
   * a set: one story is in view at a time, so deferring another simply replaces
   * this one — no id can linger to suppress a prompt for a story the user came
   * back to. The marker survives regardless; deferring hides the modal, not the
   * condition.
   */
  resumeDeferredFor: string | null
}

const INITIAL: EmbedderSwapState = { dialog: null, progress: {}, resumeDeferredFor: null }

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
  /** This story's live run, or null — the read every consumer scopes through. */
  progressFor: (s: EmbedderSwapState, storyId: string | null): SwapProgress | null =>
    storyId == null ? null : (s.progress[storyId] ?? null),
  /** Opens a fresh run's progress entry — necessarily un-cancelled. */
  beginProgress: (storyId: string): void =>
    store.setState((s) => ({
      progress: {
        ...s.progress,
        [storyId]: { storyId, done: 0, total: 0, cancelRequested: false },
      },
    })),
  /** Per-batch counts. Preserves a cancel already requested against this run. */
  setProgress: ({ storyId, done, total }: Omit<SwapProgress, 'cancelRequested'>): void =>
    store.setState((s) => ({
      progress: {
        ...s.progress,
        [storyId]: {
          storyId,
          done,
          total,
          cancelRequested: s.progress[storyId]?.cancelRequested ?? false,
        },
      },
    })),
  clearProgress: (storyId: string): void =>
    store.setState((s) => {
      if (s.progress[storyId] == null) return { progress: s.progress }
      const next = { ...s.progress }
      delete next[storyId]
      return { progress: next }
    }),
  /** No-op with no run in flight — there is nothing to cancel, and nothing to leak. */
  requestCancel: (storyId: string): void =>
    store.setState((s) => {
      const run = s.progress[storyId]
      return run == null
        ? { progress: s.progress }
        : { progress: { ...s.progress, [storyId]: { ...run, cancelRequested: true } } }
    }),
  isCancelRequested: (storyId: string): boolean =>
    store.getState().progress[storyId]?.cancelRequested ?? false,
  deferResume: (storyId: string): void => store.setState({ resumeDeferredFor: storyId }),
  /** Cleared on resume/cancel so a later interruption prompts again. */
  clearDeferredResume: (): void => store.setState({ resumeDeferredFor: null }),
  __reset: (): void => store.setState(INITIAL),
}

export type { SwapProgress }
