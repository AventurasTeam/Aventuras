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

  it('seeds from the first width only', () => {
    readerRailStore.seedViewport(850)
    expect(readerRailStore.getDisplay()).toEqual({
      lastWidth: 850,
      forced: true,
      pendingCollapsed: null,
      peek: null,
    })
    readerRailStore.seedViewport(1200)
    expect(readerRailStore.getDisplay().lastWidth).toBe(850)
    expect(readerRailStore.getDisplay().forced).toBe(true)
  })

  it('seeds a wide window unforced', () => {
    readerRailStore.seedViewport(1200)
    expect(readerRailStore.getDisplay()).toEqual({
      lastWidth: 1200,
      forced: false,
      pendingCollapsed: null,
      peek: null,
    })
  })

  it('treats a resize before any seed as the seed, not a cross', () => {
    readerRailStore.dispatchDisplay({ type: 'resize', width: 850 })
    expect(readerRailStore.getDisplay()).toEqual({
      lastWidth: 850,
      forced: true,
      pendingCollapsed: null,
      peek: null,
    })
    readerRailStore.seedViewport(1200)
    expect(readerRailStore.getDisplay().lastWidth).toBe(850)
  })

  it('reduces other events before the seed, and the seed drops them', () => {
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: true })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)
    readerRailStore.seedViewport(1200)
    expect(readerRailStore.getDisplay()).toEqual({
      lastWidth: 1200,
      forced: false,
      pendingCollapsed: null,
      peek: null,
    })
  })

  it('runs every other event through the reducer', () => {
    readerRailStore.seedViewport(1200)
    const seeded = readerRailStore.getDisplay()
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: true })
    expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)
    expect(readerRailStore.getDisplay()).toEqual(
      reduceRailDisplay(seeded, { type: 'setCollapsed', collapsed: true }),
    )
    readerRailStore.dispatchDisplay({ type: 'resize', width: 850 })
    expect(readerRailStore.getDisplay().forced).toBe(true)
    expect(readerRailStore.getDisplay().lastWidth).toBe(850)
  })

  it('__reset restores the unseeded state', () => {
    readerRailStore.seedViewport(850)
    readerRailStore.setCategory('lore')
    readerRailStore.__reset()
    expect(readerRailStore.getView()).toBe(DEFAULT_RAIL_VIEW)
    expect(readerRailStore.getDisplay().forced).toBe(false)
    readerRailStore.seedViewport(1200)
    expect(readerRailStore.getDisplay().lastWidth).toBe(1200)
  })

  it('is cleared by resetAllStores', () => {
    readerRailStore.seedViewport(850)
    readerRailStore.setCategory('thread')
    resetAllStores()
    expect(readerRailStore.getView()).toBe(DEFAULT_RAIL_VIEW)
    readerRailStore.seedViewport(1200)
    expect(readerRailStore.getDisplay().forced).toBe(false)
  })
})
