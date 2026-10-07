import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_RAIL_VIEW, isRailCollapsed, reduceRailDisplay } from '@/lib/reader-rail'
import { resetAllStores } from '@/lib/stores'

import { readerRailStore } from './reader-rail'

describe('readerRailStore view', () => {
  beforeEach(() => {
    readerRailStore.__reset()
  })

  it('starts on Characters, unfiltered', () => {
    expect(readerRailStore.getView()).toEqual({ category: 'character', filter: 'all', search: '' })
    expect(readerRailStore.getView()).toBe(DEFAULT_RAIL_VIEW)
  })

  it('resets filter and search on a category switch', () => {
    readerRailStore.setCategory('thread')
    readerRailStore.setView({ category: 'thread', filter: 'pending', search: 'amulet' })
    readerRailStore.setCategory('happening')
    expect(readerRailStore.getView()).toEqual({ category: 'happening', filter: 'all', search: '' })
    readerRailStore.setCategory('lore')
    expect(readerRailStore.getView()).toEqual({ category: 'lore', search: '' })
  })

  it('keeps the view, by reference, when the category is already current', () => {
    readerRailStore.setView({ category: 'character', filter: 'staged', search: 'Mira' })
    const before = readerRailStore.getView()
    readerRailStore.setCategory('character')
    expect(readerRailStore.getView()).toBe(before)
    expect(readerRailStore.getView()).toEqual({
      category: 'character',
      filter: 'staged',
      search: 'Mira',
    })
  })

  it('replaces the view on setView, keeping no key of the old one', () => {
    readerRailStore.setView({ category: 'character', filter: 'staged', search: 'Mira' })
    readerRailStore.setView({ category: 'lore', search: 'oath' })
    expect(readerRailStore.getView()).toEqual({ category: 'lore', search: 'oath' })
  })

  it('replaces the view on setView', () => {
    readerRailStore.setView({ category: 'item', filter: 'in-scene', search: 'blade' })
    expect(readerRailStore.getView()).toEqual({
      category: 'item',
      filter: 'in-scene',
      search: 'blade',
    })
  })
})

describe('readerRailStore display', () => {
  const PEEK = { category: 'thread', id: 'thr_1' } as const

  beforeEach(() => {
    readerRailStore.__reset()
  })

  it('shows the rail before any width lands, whatever the stored preference', () => {
    expect(readerRailStore.getDisplay()).toEqual({
      lastWidth: Number.POSITIVE_INFINITY,
      forced: false,
      pendingCollapsed: null,
      peek: null,
    })
    expect(isRailCollapsed(readerRailStore.getDisplay(), false)).toBe(false)
  })

  it('treats a first width under the collapse threshold as a cross: forced, peek closed', () => {
    readerRailStore.dispatchDisplay({ type: 'openPeek', peek: PEEK, storedCollapsed: false })
    expect(readerRailStore.getDisplay().peek).toEqual(PEEK)
    readerRailStore.dispatchDisplay({ type: 'resize', width: 850 })
    expect(readerRailStore.getDisplay()).toEqual({
      lastWidth: 850,
      forced: true,
      pendingCollapsed: null,
      peek: null,
    })
  })

  it('leaves a wide first width unforced, keeping an open peek', () => {
    readerRailStore.dispatchDisplay({ type: 'openPeek', peek: PEEK, storedCollapsed: false })
    readerRailStore.dispatchDisplay({ type: 'resize', width: 1200 })
    expect(readerRailStore.getDisplay()).toEqual({
      lastWidth: 1200,
      forced: false,
      pendingCollapsed: null,
      peek: PEEK,
    })
  })

  it('keeps a toggle made before the first width', () => {
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: true })
    readerRailStore.dispatchDisplay({ type: 'resize', width: 1200 })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)
    readerRailStore.dispatchDisplay({ type: 'resize', width: 850 })
    expect(readerRailStore.getDisplay()).toMatchObject({ forced: true, pendingCollapsed: true })
  })

  it('runs every event through the reducer', () => {
    readerRailStore.dispatchDisplay({ type: 'resize', width: 1200 })
    const wide = readerRailStore.getDisplay()
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: true })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)
    expect(readerRailStore.getDisplay()).toEqual(
      reduceRailDisplay(wide, { type: 'setCollapsed', collapsed: true }),
    )
    readerRailStore.dispatchDisplay({ type: 'resize', width: 850 })
    expect(readerRailStore.getDisplay().forced).toBe(true)
    expect(readerRailStore.getDisplay().lastWidth).toBe(850)
  })

  // After a manual expand at 850, the same width is no cross; after a reset it is a first width.
  it('__reset restores the display from before the first width', () => {
    readerRailStore.dispatchDisplay({ type: 'resize', width: 850 })
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: false })
    readerRailStore.setCategory('lore')
    readerRailStore.__reset()
    expect(readerRailStore.getView()).toBe(DEFAULT_RAIL_VIEW)
    expect(readerRailStore.getDisplay().pendingCollapsed).toBeNull()
    readerRailStore.dispatchDisplay({ type: 'resize', width: 850 })
    expect(readerRailStore.getDisplay().forced).toBe(true)
  })

  it('is cleared by resetAllStores', () => {
    readerRailStore.dispatchDisplay({ type: 'resize', width: 850 })
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: false })
    readerRailStore.setCategory('thread')
    resetAllStores()
    expect(readerRailStore.getView()).toBe(DEFAULT_RAIL_VIEW)
    readerRailStore.dispatchDisplay({ type: 'resize', width: 850 })
    expect(readerRailStore.getDisplay().forced).toBe(true)
  })
})

describe('readerRailStore writeCollapsed', () => {
  function deferred() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((settle, fail) => {
      resolve = settle
      reject = fail
    })
    return { promise, resolve, reject }
  }

  beforeEach(() => {
    readerRailStore.__reset()
  })

  it('shows the toggle at once and holds a persisted until every write settles', async () => {
    const first = deferred()
    const second = deferred()
    const firstWrite = readerRailStore.writeCollapsed(true, () => first.promise)
    const secondWrite = readerRailStore.writeCollapsed(true, () => second.promise)
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)

    readerRailStore.dispatchDisplay({ type: 'persisted', collapsed: true })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)

    first.resolve()
    await firstWrite
    readerRailStore.dispatchDisplay({ type: 'persisted', collapsed: true })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)

    second.reject(new Error('disk full'))
    await expect(secondWrite).rejects.toThrow('disk full')
    readerRailStore.dispatchDisplay({ type: 'persisted', collapsed: true })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBeNull()
  })

  it('ignores a write that settles after a reset', async () => {
    const before = deferred()
    const after = deferred()
    const beforeWrite = readerRailStore.writeCollapsed(true, () => before.promise)
    readerRailStore.__reset()
    const afterWrite = readerRailStore.writeCollapsed(false, () => after.promise)

    before.resolve()
    await beforeWrite
    readerRailStore.dispatchDisplay({ type: 'persisted', collapsed: false })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(false)

    after.resolve()
    await afterWrite
    readerRailStore.dispatchDisplay({ type: 'persisted', collapsed: false })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBeNull()
  })
})

describe('readerRailStore enterBranch', () => {
  const PEEK = { category: 'thread', id: 'thr_1' } as const

  beforeEach(() => {
    readerRailStore.__reset()
  })

  it('records the first branch and leaves a default view alone', () => {
    readerRailStore.enterBranch('br_1')
    expect(readerRailStore.getView()).toBe(DEFAULT_RAIL_VIEW)
    expect(readerRailStore.getDisplay().peek).toBeNull()
  })

  it('keeps a fresh lore view by reference on a new branch, and swaps a typed one', () => {
    readerRailStore.setView({ category: 'lore', search: '' })
    const fresh = readerRailStore.getView()
    readerRailStore.enterBranch('br_1')
    expect(readerRailStore.getView()).toBe(fresh)
    readerRailStore.setView({ category: 'lore', search: 'oath' })
    readerRailStore.enterBranch('br_2')
    expect(readerRailStore.getView()).toEqual({ category: 'lore', search: '' })
  })

  it('keeps the view and display by reference when the same branch is entered again', () => {
    readerRailStore.enterBranch('br_1')
    readerRailStore.setView({ category: 'character', filter: 'staged', search: 'Mira' })
    readerRailStore.dispatchDisplay({ type: 'openPeek', peek: PEEK, storedCollapsed: false })
    const view = readerRailStore.getView()
    const display = readerRailStore.getDisplay()
    readerRailStore.enterBranch('br_1')
    expect(readerRailStore.getView()).toBe(view)
    expect(readerRailStore.getDisplay()).toBe(display)
    expect(display.peek).toEqual(PEEK)
  })

  it('on a different branch keeps the category, resets filter and search, and clears the peek', () => {
    readerRailStore.enterBranch('br_1')
    readerRailStore.setView({ category: 'thread', filter: 'pending', search: 'amulet' })
    readerRailStore.dispatchDisplay({ type: 'openPeek', peek: PEEK, storedCollapsed: false })
    expect(readerRailStore.getDisplay().peek).toEqual(PEEK)
    readerRailStore.enterBranch('br_2')
    expect(readerRailStore.getView()).toEqual({ category: 'thread', filter: 'all', search: '' })
    expect(readerRailStore.getDisplay().peek).toBeNull()
  })

  it('resets a filter alone, with the search already empty, on a new branch', () => {
    readerRailStore.setView({ category: 'thread', filter: 'pending', search: '' })
    readerRailStore.enterBranch('br_1')
    expect(readerRailStore.getView()).toEqual({ category: 'thread', filter: 'all', search: '' })
  })

  it('__reset forgets the recorded branch', () => {
    readerRailStore.enterBranch('br_1')
    readerRailStore.__reset()
    readerRailStore.setView({ category: 'character', filter: 'staged', search: 'Mira' })
    readerRailStore.enterBranch('br_1')
    expect(readerRailStore.getView()).toEqual({ category: 'character', filter: 'all', search: '' })
  })
})
