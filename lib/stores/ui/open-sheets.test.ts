import { afterEach, describe, expect, it } from 'vitest'

import { openSheetsStore } from './open-sheets'

afterEach(() => openSheetsStore.__reset())

describe('openSheetsStore', () => {
  it('counts each registered sheet once', () => {
    const a = {}
    const b = {}
    openSheetsStore.acquire(a)
    expect(openSheetsStore.getState().open.size).toBe(1)
    openSheetsStore.acquire(b)
    expect(openSheetsStore.getState().open.size).toBe(2)
  })

  it('is idempotent, so a re-acquired token does not double-count', () => {
    const a = {}
    openSheetsStore.acquire(a)
    openSheetsStore.acquire(a)
    expect(openSheetsStore.getState().open.size).toBe(1)
    openSheetsStore.release(a)
    expect(openSheetsStore.getState().open.size).toBe(0)
  })

  it('ignores a release for a token it never held, rather than underflowing', () => {
    const held = {}
    openSheetsStore.acquire(held)
    openSheetsStore.release({})
    openSheetsStore.release({})
    // A counter would have gone negative here and read as "nothing open" forever.
    expect(openSheetsStore.getState().open.size).toBe(1)
  })

  it('releases only the named token, leaving its siblings open', () => {
    const a = {}
    const b = {}
    openSheetsStore.acquire(a)
    openSheetsStore.acquire(b)
    openSheetsStore.release(a)
    expect(openSheetsStore.getState().open.has(b)).toBe(true)
    expect(openSheetsStore.getState().open.size).toBe(1)
  })

  it('keeps the previous state identity when a held token is re-acquired', () => {
    const a = {}
    openSheetsStore.acquire(a)
    const before = openSheetsStore.getState()
    openSheetsStore.acquire(a)
    // Set.add dedupes on its own; the guard is what stops a redundant acquire
    // from minting a new state object and re-rendering every subscriber.
    expect(openSheetsStore.getState()).toBe(before)
  })

  it('keeps the previous state identity when nothing changes', () => {
    const before = openSheetsStore.getState()
    openSheetsStore.release({})
    // Selector subscribers must not re-render for a no-op release.
    expect(openSheetsStore.getState()).toBe(before)
  })
})
