import { beforeEach, describe, expect, it, vi } from 'vitest'

import { chaptersStore, resetAllStores, type StoreChapter } from '@/lib/stores'

import {
  chapterOverlaysStore,
  closeResultChapter,
  overlayChapter,
  reportChapter,
  rerunConfirmChapter,
  type CloseResult,
  type OverlaySurface,
} from './chapter-overlays'

type Guard = OverlaySurface['guard']

function surface(guard: Guard = (proceed) => proceed()): OverlaySurface {
  return { guard, navigate: vi.fn<(path: string) => void>() }
}

function row(over: Partial<StoreChapter> & Pick<StoreChapter, 'id'>): StoreChapter {
  return {
    branchId: 'br_hero',
    sequenceNumber: 2,
    title: 'The Keep Leans Closer',
    summary: '',
    theme: '',
    keywords: [],
    startEntryId: 'entry_40',
    endEntryId: 'entry_58',
    tokenCount: 0,
    closedAt: 1,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    hasCloseReport: true,
    closeReportActionId: 'act_close_2',
    ...over,
  }
}

describe('chapterOverlaysStore', () => {
  beforeEach(() => {
    resetAllStores()
  })

  it('opens the review window on the report its chapter holds, and closes it', () => {
    chaptersStore.hydrate('br_hero', [row({ id: 'chap_hero_2' })])
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_hero_2' })
    expect(chapterOverlaysStore.getState().review).toStrictEqual({
      chapterId: 'chap_hero_2',
      actionId: 'act_close_2',
    })
    chapterOverlaysStore.closeReviewWindow()
    expect(chapterOverlaysStore.getState().review).toBeNull()
  })

  it('opens on no report for a chapter the store does not hold', () => {
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_missing' })
    expect(chapterOverlaysStore.getState().review).toStrictEqual({
      chapterId: 'chap_missing',
      actionId: null,
    })
  })

  it('holds no surface until one registers', () => {
    expect(chapterOverlaysStore.currentSurface()).toBeNull()
  })

  it('lets the latest registration win', () => {
    const under = surface()
    const top = surface()
    chapterOverlaysStore.registerSurface(under)
    chapterOverlaysStore.registerSurface(top)
    expect(chapterOverlaysStore.currentSurface()).toBe(top)
  })

  it('leaves the newer surface in place when a stale registration unregisters', () => {
    const under = surface()
    const top = surface()
    const unregisterUnder = chapterOverlaysStore.registerSurface(under)
    chapterOverlaysStore.registerSurface(top)
    unregisterUnder()
    expect(chapterOverlaysStore.currentSurface()).toBe(top)
  })

  it('clears the slot when the holding registration unregisters', () => {
    const unregister = chapterOverlaysStore.registerSurface(surface())
    unregister()
    expect(chapterOverlaysStore.currentSurface()).toBeNull()
  })

  it('tells two registrations of one surface object apart', () => {
    const route = surface()
    const unregisterFirst = chapterOverlaysStore.registerSurface(route)
    chapterOverlaysStore.registerSurface(route)
    unregisterFirst()
    expect(chapterOverlaysStore.currentSurface()).toBe(route)
  })

  it('runs the guard before holding a close request, holding nothing until it proceeds', () => {
    const guard = vi.fn<Guard>()
    chapterOverlaysStore.registerSurface(surface(guard))
    chapterOverlaysStore.openCloseModal({ branchId: 'br_hero', endEntryId: 'ent_47' })
    expect(guard).toHaveBeenCalledTimes(1)
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()

    const [[proceed]] = guard.mock.calls
    proceed()
    expect(chapterOverlaysStore.getState().closeModal).toStrictEqual({
      branchId: 'br_hero',
      endEntryId: 'ent_47',
    })
  })

  it('holds nothing when the guard never proceeds', () => {
    chapterOverlaysStore.registerSurface(surface(() => {}))
    chapterOverlaysStore.openCloseModal({ branchId: 'br_hero' })
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
  })

  it('holds a close request at once with no surface registered', () => {
    chapterOverlaysStore.openCloseModal({ branchId: 'br_hero' })
    expect(chapterOverlaysStore.getState().closeModal).toStrictEqual({ branchId: 'br_hero' })
    chapterOverlaysStore.closeCloseModal()
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
  })

  it("replaces a held close result with a newer close's", () => {
    const first: CloseResult = {
      branchId: 'br_hero',
      openSeq: 1,
      chapterId: 'chap_hero_2',
      actionId: 'act_close_2',
      rerun: false,
      stoppedTasks: 1,
    }
    chapterOverlaysStore.showCloseResult(first)
    chapterOverlaysStore.showCloseResult({
      ...first,
      chapterId: 'chap_hero_3',
      actionId: 'act_close_3',
      stoppedTasks: 0,
    })
    expect(chapterOverlaysStore.getState().closeResult).toStrictEqual({
      ...first,
      chapterId: 'chap_hero_3',
      actionId: 'act_close_3',
      stoppedTasks: 0,
    })
    chapterOverlaysStore.clearCloseResult()
    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
  })

  it("holds a copy of a caller's input, never the caller's object", () => {
    const review = { chapterId: 'chap_hero_2' }
    chapterOverlaysStore.openReviewWindow(review)
    expect(chapterOverlaysStore.getState().review).not.toBe(review)

    const request = { branchId: 'br_hero', endEntryId: 'ent_47' }
    chapterOverlaysStore.openCloseModal(request)
    expect(chapterOverlaysStore.getState().closeModal).not.toBe(request)

    const result: CloseResult = {
      branchId: 'br_hero',
      openSeq: 1,
      chapterId: 'chap_hero_2',
      actionId: 'act_close_2',
      rerun: false,
      stoppedTasks: 0,
    }
    chapterOverlaysStore.showCloseResult(result)
    expect(chapterOverlaysStore.getState().closeResult).not.toBe(result)
  })

  it('__reset clears the state and the surface slot', () => {
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_hero_2' })
    chapterOverlaysStore.openCloseModal({ branchId: 'br_hero' })
    chapterOverlaysStore.openRerunConfirm({ branchId: 'br_hero', chapterId: 'chap_hero_2' })
    chapterOverlaysStore.showCloseResult({
      branchId: 'br_hero',
      openSeq: 1,
      chapterId: 'chap_hero_2',
      actionId: 'act_close_2',
      rerun: false,
      stoppedTasks: 0,
    })
    chapterOverlaysStore.registerSurface(surface())
    chapterOverlaysStore.__reset()
    expect(chapterOverlaysStore.getState()).toStrictEqual({
      review: null,
      closeModal: null,
      closeResult: null,
      rerunConfirm: null,
    })
    expect(chapterOverlaysStore.currentSurface()).toBeNull()
  })

  it('is cleared by resetAllStores', () => {
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_hero_2' })
    chapterOverlaysStore.registerSurface(surface())
    resetAllStores()
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(chapterOverlaysStore.currentSurface()).toBeNull()
  })
})

// chapter-timeline.md → Review window: Re-run… closes the window first, so the guard's dialog
// never sits over it, and the confirm's Cancel brings it back.
describe('chapterOverlaysStore — the re-run confirm', () => {
  beforeEach(() => {
    resetAllStores()
    chaptersStore.hydrate('br_hero', [row({ id: 'chap_hero_2' })])
  })

  it('from the card runs the guard before holding the request, and holds nothing until it proceeds', () => {
    const guard = vi.fn<Guard>()
    chapterOverlaysStore.registerSurface(surface(guard))
    chapterOverlaysStore.openRerunConfirm({ branchId: 'br_hero', chapterId: 'chap_hero_2' })
    expect(guard).toHaveBeenCalledTimes(1)
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()

    const [[proceed]] = guard.mock.calls
    proceed()
    expect(chapterOverlaysStore.getState().rerunConfirm).toStrictEqual({
      branchId: 'br_hero',
      chapterId: 'chap_hero_2',
      reopenReview: false,
    })
  })

  it('from the review window closes the window before the guard runs, and remembers it', () => {
    const seen: unknown[] = []
    const guard = vi.fn<Guard>(() => {
      seen.push(chapterOverlaysStore.getState().review)
    })
    chapterOverlaysStore.registerSurface(surface(guard))
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_hero_2' })
    chapterOverlaysStore.openRerunConfirm({
      branchId: 'br_hero',
      chapterId: 'chap_hero_2',
      fromReview: true,
    })
    expect(seen).toEqual([null])
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()

    const [[proceed]] = guard.mock.calls
    proceed()
    expect(chapterOverlaysStore.getState().rerunConfirm).toStrictEqual({
      branchId: 'br_hero',
      chapterId: 'chap_hero_2',
      reopenReview: true,
    })
    expect(chapterOverlaysStore.getState().review).toBeNull()
  })

  it('remembers no window when none was open', () => {
    chapterOverlaysStore.openRerunConfirm({
      branchId: 'br_hero',
      chapterId: 'chap_hero_2',
      fromReview: true,
    })
    expect(chapterOverlaysStore.getState().rerunConfirm?.reopenReview).toBe(false)
  })

  it('holds the request at once with no surface registered', () => {
    chapterOverlaysStore.openRerunConfirm({ branchId: 'br_hero', chapterId: 'chap_hero_2' })
    expect(chapterOverlaysStore.getState().rerunConfirm).toStrictEqual({
      branchId: 'br_hero',
      chapterId: 'chap_hero_2',
      reopenReview: false,
    })
  })

  it("closing with reopen brings the remembered window back on the chapter's current report", () => {
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_hero_2' })
    chapterOverlaysStore.openRerunConfirm({
      branchId: 'br_hero',
      chapterId: 'chap_hero_2',
      fromReview: true,
    })
    chaptersStore.hydrate('br_hero', [
      row({ id: 'chap_hero_2', closeReportActionId: 'act_close_2b' }),
    ])
    chapterOverlaysStore.closeRerunConfirm({ reopen: true })
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(chapterOverlaysStore.getState().review).toStrictEqual({
      chapterId: 'chap_hero_2',
      actionId: 'act_close_2b',
    })
  })

  it('closing without reopen leaves a remembered window closed', () => {
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_hero_2' })
    chapterOverlaysStore.openRerunConfirm({
      branchId: 'br_hero',
      chapterId: 'chap_hero_2',
      fromReview: true,
    })
    chapterOverlaysStore.closeRerunConfirm({ reopen: false })
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(chapterOverlaysStore.getState().review).toBeNull()
  })

  it("reopens nothing for the card's request", () => {
    chapterOverlaysStore.openRerunConfirm({ branchId: 'br_hero', chapterId: 'chap_hero_2' })
    chapterOverlaysStore.closeRerunConfirm({ reopen: true })
    expect(chapterOverlaysStore.getState().review).toBeNull()
  })

  it('closing with no request held changes nothing', () => {
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_hero_2' })
    const before = chapterOverlaysStore.getState()
    chapterOverlaysStore.closeRerunConfirm({ reopen: true })
    expect(chapterOverlaysStore.getState()).toBe(before)
  })
})

describe('the overlays hold rule', () => {
  const held = {
    branchId: 'br_1',
    hasCloseReport: true,
    closeReportActionId: 'act_1',
    sequenceNumber: 1,
  }
  const other = {
    branchId: 'br_1',
    hasCloseReport: true,
    closeReportActionId: 'act_2',
    sequenceNumber: 2,
  }
  const chapters = new Map([
    ['chap_1', held],
    ['chap_2', other],
  ])
  const result: CloseResult = {
    branchId: 'br_1',
    openSeq: 3,
    chapterId: 'chap_1',
    actionId: 'act_1',
    rerun: false,
    stoppedTasks: 0,
  }
  const open = { branchId: 'br_1', openSeq: 3 }

  it('gives back a chapter with a report on the open branch, and null for any other', () => {
    expect(overlayChapter(held, 'br_1')).toBe(held)
    expect(overlayChapter(undefined, 'br_1')).toBeNull()
    expect(overlayChapter({ ...held, hasCloseReport: false }, 'br_1')).toBeNull()
    expect(overlayChapter(held, 'br_2')).toBeNull()
    expect(overlayChapter(held, null)).toBeNull()
  })

  // C7: a re-run's commit, or its undo, replaces the row's report.
  it('holds a chapter only while it holds the report the overlay opened on', () => {
    expect(reportChapter(held, 'br_1', 'act_1')).toBe(held)
    expect(reportChapter(held, 'br_1', 'act_rerun')).toBeNull()
    expect(reportChapter(held, 'br_1', null)).toBeNull()
    expect(reportChapter({ ...held, hasCloseReport: false }, 'br_1', 'act_1')).toBeNull()
    expect(reportChapter(held, 'br_2', 'act_1')).toBeNull()
  })

  it("gives back a close result's own chapter while the result is the open's and it stands", () => {
    expect(closeResultChapter(result, chapters, open)).toBe(held)
    expect(
      closeResultChapter({ ...result, chapterId: 'chap_2', actionId: 'act_2' }, chapters, open),
    ).toBe(other)
    expect(closeResultChapter(null, chapters, open)).toBeNull()
    expect(closeResultChapter({ ...result, branchId: 'br_2' }, chapters, open)).toBeNull()
    expect(closeResultChapter(result, chapters, { ...open, branchId: null })).toBeNull()
    expect(
      closeResultChapter(result, new Map([['chap_1', { ...held, hasCloseReport: false }]]), open),
    ).toBeNull()
    expect(closeResultChapter(result, new Map(), open)).toBeNull()
  })

  it("drops a close result once the row's report is another action's", () => {
    expect(
      closeResultChapter(
        result,
        new Map([['chap_1', { ...held, closeReportActionId: 'act_rerun' }]]),
        open,
      ),
    ).toBeNull()
  })

  // A reopen of the same story keeps its branch id; only the open's sequence tells them apart.
  it('gives back null for a result held from an earlier open of the same branch', () => {
    expect(closeResultChapter(result, chapters, { ...open, openSeq: 4 })).toBeNull()
  })

  it("holds a re-run request on the open branch's latest chapter with a report, and nothing else", () => {
    const request = { branchId: 'br_1', chapterId: 'chap_2', reopenReview: false }
    expect(rerunConfirmChapter(request, chapters, 'br_1')).toBe(other)
    expect(rerunConfirmChapter(null, chapters, 'br_1')).toBeNull()
    expect(rerunConfirmChapter({ ...request, chapterId: 'chap_1' }, chapters, 'br_1')).toBeNull()
    expect(rerunConfirmChapter({ ...request, chapterId: 'chap_9' }, chapters, 'br_1')).toBeNull()
    expect(rerunConfirmChapter(request, chapters, 'br_2')).toBeNull()
    expect(rerunConfirmChapter(request, chapters, null)).toBeNull()
    expect(
      rerunConfirmChapter(
        request,
        new Map([['chap_2', { ...other, hasCloseReport: false }]]),
        'br_1',
      ),
    ).toBeNull()
  })
  // A fork copies chapter ids: the open branch's own chap_2 isn't the request's.
  it("holds no request on another branch's copy of its chapter", () => {
    const request = { branchId: 'br_1', chapterId: 'chap_2', reopenReview: false }
    const fork = new Map([['chap_2', { ...other, branchId: 'br_fork' }]])
    expect(rerunConfirmChapter(request, fork, 'br_fork')).toBeNull()
  })
})
