import { afterEach, describe, expect, it } from 'vitest'

import { blockingOverlaysStore } from './blocking-overlays'

afterEach(() => blockingOverlaysStore.__reset())

describe('blockingOverlaysStore', () => {
  it('counts each registered sheet once', () => {
    const a = {}
    const b = {}
    blockingOverlaysStore.acquire(a)
    expect(blockingOverlaysStore.getState().open.size).toBe(1)
    blockingOverlaysStore.acquire(b)
    expect(blockingOverlaysStore.getState().open.size).toBe(2)
  })

  it('is idempotent, so a re-acquired token does not double-count', () => {
    const a = {}
    blockingOverlaysStore.acquire(a)
    blockingOverlaysStore.acquire(a)
    expect(blockingOverlaysStore.getState().open.size).toBe(1)
    blockingOverlaysStore.release(a)
    expect(blockingOverlaysStore.getState().open.size).toBe(0)
  })

  it('ignores a release for a token it never held, rather than underflowing', () => {
    const held = {}
    blockingOverlaysStore.acquire(held)
    blockingOverlaysStore.release({})
    blockingOverlaysStore.release({})
    // A counter would have gone negative here and read as "nothing open" forever.
    expect(blockingOverlaysStore.getState().open.size).toBe(1)
  })

  it('releases only the named token, leaving its siblings open', () => {
    const a = {}
    const b = {}
    blockingOverlaysStore.acquire(a)
    blockingOverlaysStore.acquire(b)
    blockingOverlaysStore.release(a)
    expect(blockingOverlaysStore.getState().open.has(b)).toBe(true)
    expect(blockingOverlaysStore.getState().open.size).toBe(1)
  })

  it('keeps the previous state identity when a held token is re-acquired', () => {
    const a = {}
    blockingOverlaysStore.acquire(a)
    const before = blockingOverlaysStore.getState()
    blockingOverlaysStore.acquire(a)
    // Set.add dedupes on its own; the guard is what stops a redundant acquire
    // from minting a new state object and re-rendering every subscriber.
    expect(blockingOverlaysStore.getState()).toBe(before)
  })

  it('keeps the previous state identity when nothing changes', () => {
    const before = blockingOverlaysStore.getState()
    blockingOverlaysStore.release({})
    // Selector subscribers must not re-render for a no-op release.
    expect(blockingOverlaysStore.getState()).toBe(before)
  })
})
