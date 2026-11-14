import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/** A focused route's leave guard and navigator, which an overlay's row press runs through (C7). */
export type OverlaySurface = {
  guard: (proceed: () => void) => void
  navigate: (path: string) => void
}

export type CloseModalRequest = { branchId: string; endEntryId?: string }

/** A committed close, held for the banner's done state until it is dismissed or reviewed. */
export type CloseResult = { branchId: string; chapterId: string; stoppedTasks: number }

export type ChapterOverlaysState = {
  review: { chapterId: string } | null
  /** No reader yet: the close modal's host (M5.10). */
  closeModal: CloseModalRequest | null
  closeResult: CloseResult | null
}

const INITIAL: ChapterOverlaysState = { review: null, closeModal: null, closeResult: null }

const store = createStore<ChapterOverlaysState>()(() => INITIAL)

// Functions, never rendered, so kept outside the zustand state: a registration re-renders nothing.
// The token lets only the registration that holds the slot clear it.
let surfaceSlot: { token: object; surface: OverlaySurface } | null = null

export const chapterOverlaysStore = {
  useOverlays: <T>(selector: (s: ChapterOverlaysState) => T): T => useStore(store, selector),
  getState: (): ChapterOverlaysState => store.getState(),
  openReviewWindow: ({ chapterId }: { chapterId: string }): void =>
    store.setState({ review: { chapterId } }),
  closeReviewWindow: (): void => store.setState({ review: null }),
  /** Runs the current surface's guard before holding the request, so no trigger skips it. */
  openCloseModal: ({ branchId, endEntryId }: CloseModalRequest): void => {
    const hold = () =>
      store.setState({ closeModal: endEntryId == null ? { branchId } : { branchId, endEntryId } })
    const surface = surfaceSlot?.surface
    if (surface == null) hold()
    else surface.guard(hold)
  },
  closeCloseModal: (): void => store.setState({ closeModal: null }),
  /** The latest registration wins; its unregister clears the slot only while it still holds it. */
  registerSurface: (surface: OverlaySurface): (() => void) => {
    const token = {}
    surfaceSlot = { token, surface }
    return () => {
      if (surfaceSlot?.token === token) surfaceSlot = null
    }
  },
  currentSurface: (): OverlaySurface | null => surfaceSlot?.surface ?? null,
  /** A newer close's result replaces the one held. */
  showCloseResult: ({ branchId, chapterId, stoppedTasks }: CloseResult): void =>
    store.setState({ closeResult: { branchId, chapterId, stoppedTasks } }),
  clearCloseResult: (): void => store.setState({ closeResult: null }),
  __reset: (): void => {
    surfaceSlot = null
    store.setState(INITIAL)
  },
}
