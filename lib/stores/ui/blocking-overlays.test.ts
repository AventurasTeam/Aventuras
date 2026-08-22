import { afterEach, describe, expect, it } from 'vitest'

import { acquire, blockingOverlaysStore, release } from './blocking-overlays'

afterEach(() => blockingOverlaysStore.__reset())

describe('blockingOverlaysStore', () => {
  it('counts each registered sheet once', () => {
    const a = {}
    const b = {}
    acquire(a)
    expect(blockingOverlaysStore.getState().open.size).toBe(1)
    acquire(b)
    expect(blockingOverlaysStore.getState().open.size).toBe(2)
  })

  it('is idempotent, so a re-acquired token does not double-count', () => {
    const a = {}
    acquire(a)
    acquire(a)
    expect(blockingOverlaysStore.getState().open.size).toBe(1)
    release(a)
    expect(blockingOverlaysStore.getState().open.size).toBe(0)
  })

  it('ignores a release for a token it never held, rather than underflowing', () => {
    const held = {}
    acquire(held)
    release({})
    release({})
    // A counter would have gone negative here and read as "nothing open" forever.
    expect(blockingOverlaysStore.getState().open.size).toBe(1)
  })

  it('releases only the named token, leaving its siblings open', () => {
    const a = {}
    const b = {}
    acquire(a)
    acquire(b)
    release(a)
    expect(blockingOverlaysStore.getState().open.has(b)).toBe(true)
    expect(blockingOverlaysStore.getState().open.size).toBe(1)
  })

  it('keeps the previous state identity when a held token is re-acquired', () => {
    const a = {}
    acquire(a)
    const before = blockingOverlaysStore.getState()
    acquire(a)
    // Set.add dedupes on its own; the guard is what stops a redundant acquire
    // from minting a new state object and re-rendering every subscriber.
    expect(blockingOverlaysStore.getState()).toBe(before)
  })

  it('keeps the previous state identity when nothing changes', () => {
    const before = blockingOverlaysStore.getState()
    release({})
    // Selector subscribers must not re-render for a no-op release.
    expect(blockingOverlaysStore.getState()).toBe(before)
  })
})
