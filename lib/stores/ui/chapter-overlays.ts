import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { chaptersStore, type StoreChapter } from '../chapters/chapters'

/** A focused route's leave guard and navigator, which an overlay's row press runs through (C7). */
export type OverlaySurface = {
  guard: (proceed: () => void) => void
  navigate: (path: string) => void
}

export type CloseModalRequest = { branchId: string; endEntryId?: string }

/** The open review window and its report (`closeReportActionId`). A fork copies chapter id and
 * action, so only the branch tells them apart. */
export type ReviewRequest = { branchId: string; chapterId: string; actionId: string | null }

/** The re-run confirm's request; `reopenReview` when `Re-run…` closed the review window for it. */
export type RerunConfirmRequest = { branchId: string; chapterId: string; reopenReview: boolean }

/** A committed close or re-run, held for the commit banner's done state. */
export type CloseResult = {
  branchId: string
  /** The story open it committed in: a reopen keeps the branch id; only this tells them apart. */
  openSeq: number
  chapterId: string
  /** The run that committed, its report's `actionId`. */
  actionId: string
  /** A re-run's commit: the banner names the re-run rather than the chapter's title. */
  rerun: boolean
  stoppedTasks: number
}

export type ChapterOverlaysState = {
  review: ReviewRequest | null
  /** The close modal's request; the host drops one whose branch isn't the open one. */
  closeModal: CloseModalRequest | null
  closeResult: CloseResult | null
  rerunConfirm: RerunConfirmRequest | null
}

type ReportHolder = Pick<StoreChapter, 'hasCloseReport'>
type HeldReport = ReportHolder & Pick<StoreChapter, 'closeReportActionId'>
type OpenRef = { branchId: string | null; openSeq: number }

/** C7: an overlay's chapter stands while it holds a report; else null. Pass the open branch's row. */
export function overlayChapter<C extends ReportHolder>(chapter: C | undefined): C | null {
  return chapter != null && chapter.hasCloseReport ? chapter : null
}

/** C7: the chapter while it holds the report an overlay opened on; a re-run or its undo ends it. */
export function reportChapter<C extends HeldReport>(
  chapter: C | undefined,
  actionId: string | null,
): C | null {
  const held = overlayChapter(chapter)
  return held != null && held.closeReportActionId === actionId ? held : null
}

/** C7: a close result's chapter while it is this open's and stands; else null. */
export function closeResultChapter<C extends HeldReport>(
  result: CloseResult | null,
  branchChapters: ReadonlyMap<string, C>,
  open: OpenRef,
): C | null {
  if (result == null || result.branchId !== open.branchId || result.openSeq !== open.openSeq)
    return null
  return reportChapter(branchChapters.get(result.chapterId), result.actionId)
}

/** C7: the re-run confirm's chapter while it holds a report as the open branch's latest. */
export function rerunConfirmChapter<C extends ReportHolder & Pick<StoreChapter, 'sequenceNumber'>>(
  request: RerunConfirmRequest | null,
  branchChapters: ReadonlyMap<string, C>,
  openBranchId: string | null,
): C | null {
  if (request == null || request.branchId !== openBranchId) return null
  const chapter = overlayChapter(branchChapters.get(request.chapterId))
  if (chapter == null) return null
  for (const row of branchChapters.values())
    if (row.sequenceNumber > chapter.sequenceNumber) return null
  return chapter
}

/** C7: `closeResultChapter` on `open.branchId`'s rows, the branch it compares the result to. */
export function useCloseResultChapter(
  result: CloseResult | null,
  open: OpenRef,
): StoreChapter | null {
  return chaptersStore.useChapters(open.branchId, (rows) => closeResultChapter(result, rows, open))
}

/** C7: `rerunConfirmChapter` on `openBranchId`'s rows, the branch it compares the request to. */
export function useRerunConfirmChapter(
  request: RerunConfirmRequest | null,
  openBranchId: string | null,
): StoreChapter | null {
  return chaptersStore.useChapters(openBranchId, (rows) =>
    rerunConfirmChapter(request, rows, openBranchId),
  )
}

const INITIAL: ChapterOverlaysState = {
  review: null,
  closeModal: null,
  closeResult: null,
  rerunConfirm: null,
}

const store = createStore<ChapterOverlaysState>()(() => INITIAL)

// Functions, never rendered, so kept outside the zustand state: a registration re-renders nothing.
let surfaceSlot: { token: object; surface: OverlaySurface } | null = null

function reviewOf(branchId: string, chapterId: string): ReviewRequest {
  const chapter = chaptersStore.getById(branchId, chapterId)
  return { branchId, chapterId, actionId: chapter?.closeReportActionId ?? null }
}

function guarded(proceed: () => void): void {
  const surface = surfaceSlot?.surface
  if (surface == null) proceed()
  else surface.guard(proceed)
}

export const chapterOverlaysStore = {
  useOverlays: <T>(selector: (s: ChapterOverlaysState) => T): T => useStore(store, selector),
  getState: (): ChapterOverlaysState => store.getState(),
  /**
   * Refused while a re-run request is held (its confirm mounts once its read lands). Returns
   * whether the window opened.
   */
  openReviewWindow: (input: { branchId: string; chapterId: string }): boolean => {
    if (store.getState().rerunConfirm != null) return false
    store.setState({ review: reviewOf(input.branchId, input.chapterId) })
    return true
  },
  closeReviewWindow: (): void => store.setState({ review: null }),
  /** Runs the current surface's guard before holding the request, so no trigger skips it. */
  openCloseModal: ({ branchId, endEntryId }: CloseModalRequest): void =>
    guarded(() =>
      store.setState({ closeModal: endEntryId == null ? { branchId } : { branchId, endEntryId } }),
    ),
  closeCloseModal: (): void => store.setState({ closeModal: null }),
  /**
   * From the review window it closes first, so the guard's dialog never sits over it, and the
   * request remembers that. A guard Cancel leaves it closed; a press during its exit is dropped.
   */
  openRerunConfirm: ({
    branchId,
    chapterId,
    fromReview = false,
  }: {
    branchId: string
    chapterId: string
    fromReview?: boolean
  }): void => {
    if (fromReview) {
      if (store.getState().review == null) return
      store.setState({ review: null })
    }
    guarded(() =>
      store.setState({ rerunConfirm: { branchId, chapterId, reopenReview: fromReview } }),
    )
  },
  /** `reopen` brings back the review window the request closed; a card's request has none. */
  closeRerunConfirm: ({ reopen }: { reopen: boolean }): void => {
    const request = store.getState().rerunConfirm
    if (request == null) return
    store.setState(
      reopen && request.reopenReview
        ? { rerunConfirm: null, review: reviewOf(request.branchId, request.chapterId) }
        : { rerunConfirm: null },
    )
  },
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
  showCloseResult: (result: CloseResult): void => store.setState({ closeResult: { ...result } }),
  clearCloseResult: (): void => store.setState({ closeResult: null }),
  __reset: (): void => {
    surfaceSlot = null
    store.setState(INITIAL)
  },
}
