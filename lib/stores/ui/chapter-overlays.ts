import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { chaptersStore, type StoreChapter } from '../chapters/chapters'

/** A focused route's leave guard and navigator, which an overlay's row press runs through (C7). */
export type OverlaySurface = {
  guard: (proceed: () => void) => void
  navigate: (path: string) => void
}

export type CloseModalRequest = { branchId: string; endEntryId?: string }

/** The open review window: its chapter and the report (`closeReportActionId`) it opened on. */
export type ReviewRequest = { chapterId: string; actionId: string | null }

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

type ReportHolder = Pick<StoreChapter, 'branchId' | 'hasCloseReport'>
type HeldReport = ReportHolder & Pick<StoreChapter, 'closeReportActionId'>

/** C7: an overlay's chapter stands while it holds a report on the open branch; else null. */
export function overlayChapter<C extends ReportHolder>(
  chapter: C | undefined,
  openBranchId: string | null,
): C | null {
  return chapter != null && chapter.hasCloseReport && chapter.branchId === openBranchId
    ? chapter
    : null
}

/** C7: the chapter while it holds the report an overlay opened on; a re-run or its undo ends it. */
export function reportChapter<C extends HeldReport>(
  chapter: C | undefined,
  openBranchId: string | null,
  actionId: string | null,
): C | null {
  const held = overlayChapter(chapter, openBranchId)
  return held != null && held.closeReportActionId === actionId ? held : null
}

/** C7: a committed close's chapter while its result is this open's and it stands; else null. */
export function closeResultChapter<C extends HeldReport>(
  result: CloseResult | null,
  chapters: ReadonlyMap<string, C>,
  open: { branchId: string | null; openSeq: number },
): C | null {
  if (result == null || result.branchId !== open.branchId || result.openSeq !== open.openSeq)
    return null
  return reportChapter(chapters.get(result.chapterId), open.branchId, result.actionId)
}

/** C7: the re-run confirm's chapter while it stands with a report as the open branch's latest. */
export function rerunConfirmChapter<C extends ReportHolder & Pick<StoreChapter, 'sequenceNumber'>>(
  request: RerunConfirmRequest | null,
  chapters: ReadonlyMap<string, C>,
  openBranchId: string | null,
): C | null {
  if (request == null || request.branchId !== openBranchId) return null
  const chapter = overlayChapter(chapters.get(request.chapterId), openBranchId)
  if (chapter == null) return null
  for (const row of chapters.values())
    if (row.branchId === openBranchId && row.sequenceNumber > chapter.sequenceNumber) return null
  return chapter
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

function reviewOf(chapterId: string): ReviewRequest {
  return { chapterId, actionId: chaptersStore.getById(chapterId)?.closeReportActionId ?? null }
}

function guarded(proceed: () => void): void {
  const surface = surfaceSlot?.surface
  if (surface == null) proceed()
  else surface.guard(proceed)
}

export const chapterOverlaysStore = {
  useOverlays: <T>(selector: (s: ChapterOverlaysState) => T): T => useStore(store, selector),
  getState: (): ChapterOverlaysState => store.getState(),
  openReviewWindow: (input: { chapterId: string }): void =>
    store.setState({ review: reviewOf(input.chapterId) }),
  closeReviewWindow: (): void => store.setState({ review: null }),
  /** Runs the current surface's guard before holding the request, so no trigger skips it. */
  openCloseModal: ({ branchId, endEntryId }: CloseModalRequest): void =>
    guarded(() =>
      store.setState({ closeModal: endEntryId == null ? { branchId } : { branchId, endEntryId } }),
    ),
  closeCloseModal: (): void => store.setState({ closeModal: null }),
  /**
   * From the review window the window closes first, so the guard's dialog never sits over it, and
   * the request remembers it. A guard Cancel holds no request, so the window stays closed. A press
   * made during the window's exit is dropped, as a row press is.
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
        ? { rerunConfirm: null, review: reviewOf(request.chapterId) }
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
