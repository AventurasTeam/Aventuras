import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAllStores } from '@/lib/stores'

import { chapterOverlaysStore, type OverlaySurface } from './chapter-overlays'

type Guard = OverlaySurface['guard']

function surface(guard: Guard = (proceed) => proceed()): OverlaySurface {
  return { guard, navigate: vi.fn<(path: string) => void>() }
}

describe('chapterOverlaysStore', () => {
  beforeEach(() => {
    chapterOverlaysStore.__reset()
  })

  it('opens the review window on a chapter and closes it', () => {
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_hero_2' })
    expect(chapterOverlaysStore.getState().review).toStrictEqual({ chapterId: 'chap_hero_2' })
    chapterOverlaysStore.closeReviewWindow()
    expect(chapterOverlaysStore.getState().review).toBeNull()
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
    chapterOverlaysStore.showCloseResult({
      branchId: 'br_hero',
      chapterId: 'chap_hero_2',
      stoppedTasks: 1,
    })
    chapterOverlaysStore.showCloseResult({
      branchId: 'br_hero',
      chapterId: 'chap_hero_3',
      stoppedTasks: 0,
    })
    expect(chapterOverlaysStore.getState().closeResult).toStrictEqual({
      branchId: 'br_hero',
      chapterId: 'chap_hero_3',
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

    const result = { branchId: 'br_hero', chapterId: 'chap_hero_2', stoppedTasks: 0 }
    chapterOverlaysStore.showCloseResult(result)
    expect(chapterOverlaysStore.getState().closeResult).not.toBe(result)
  })

  it('__reset clears the state and the surface slot', () => {
    chapterOverlaysStore.openReviewWindow({ chapterId: 'chap_hero_2' })
    chapterOverlaysStore.openCloseModal({ branchId: 'br_hero' })
    chapterOverlaysStore.showCloseResult({
      branchId: 'br_hero',
      chapterId: 'chap_hero_2',
      stoppedTasks: 0,
    })
    chapterOverlaysStore.registerSurface(surface())
    chapterOverlaysStore.__reset()
    expect(chapterOverlaysStore.getState()).toStrictEqual({
      review: null,
      closeModal: null,
      closeResult: null,
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
