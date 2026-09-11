import { describe, it, expect } from 'vitest'
import { isBodyLocked, isWithinCloseGrace, hasEntitledOwner } from './scrollLock'
import { MODAL_CLOSE_TRANSITION_MS } from '$lib/constants/layout'

/** The half-locked states are the point: they are what the library's deferred apply produces. */
describe('isBodyLocked', () => {
  it('reports a lock from pointer-events alone', () => {
    expect(isBodyLocked('none', '')).toBe(true)
  })

  it('reports a lock from overflow alone', () => {
    expect(isBodyLocked('', 'hidden')).toBe(true)
  })

  it('reports a lock when both are set', () => {
    expect(isBodyLocked('none', 'hidden')).toBe(true)
  })

  it('reports no lock when neither is set', () => {
    expect(isBodyLocked('', '')).toBe(false)
  })

  it('ignores values that are not the locked ones', () => {
    expect(isBodyLocked('auto', 'visible')).toBe(false)
    expect(isBodyLocked('all', 'auto')).toBe(false)
  })
})

/** The grace has to expire: a stalled exit animation would otherwise veto recovery forever. */
describe('isWithinCloseGrace', () => {
  it('keeps a just-closed overlay entitled', () => {
    expect(isWithinCloseGrace(1000, 1000)).toBe(true)
    expect(isWithinCloseGrace(1000, 1000 + MODAL_CLOSE_TRANSITION_MS - 1)).toBe(true)
  })

  it('drops entitlement once the exit has had time to finish', () => {
    expect(isWithinCloseGrace(1000, 1000 + MODAL_CLOSE_TRANSITION_MS)).toBe(false)
  })

  it('drops entitlement for an overlay stalled at closed', () => {
    expect(isWithinCloseGrace(1000, 1000 + 60_000)).toBe(false)
  })
})

describe('hasEntitledOwner', () => {
  const overlay = () => ({})
  const GRACE = MODAL_CLOSE_TRANSITION_MS

  it('is entitled while an overlay is open', () => {
    expect(hasEntitledOwner([overlay()], [], new WeakMap(), 0)).toBe(true)
  })

  it('is not entitled when nothing is on screen', () => {
    expect(hasEntitledOwner([], [], new WeakMap(), 0)).toBe(false)
  })

  it('starts the clock the first time a closing overlay is seen', () => {
    const el = overlay()
    const since = new WeakMap<object, number>()
    expect(hasEntitledOwner([], [el], since, 1000)).toBe(true)
    expect(since.get(el)).toBe(1000)
  })

  it('stays entitled through the exit, then stops', () => {
    const el = overlay()
    const since = new WeakMap<object, number>()
    hasEntitledOwner([], [el], since, 1000)
    expect(hasEntitledOwner([], [el], since, 1000 + GRACE - 1)).toBe(true)
    expect(hasEntitledOwner([], [el], since, 1000 + GRACE)).toBe(false)
  })

  /** Reusing the first close's timestamp would drop the lock while the second close is running. */
  it('restarts the clock when the same overlay reopens and closes again', () => {
    const el = overlay()
    const since = new WeakMap<object, number>()

    hasEntitledOwner([], [el], since, 0)
    expect(hasEntitledOwner([], [el], since, GRACE)).toBe(false)

    // Reopened: the stale timestamp must not survive it
    expect(hasEntitledOwner([el], [], since, GRACE + 100)).toBe(true)
    expect(since.get(el)).toBeUndefined()

    // Closing again, long after the first close would have expired
    expect(hasEntitledOwner([], [el], since, GRACE + 200)).toBe(true)
    expect(hasEntitledOwner([], [el], since, GRACE + 200 + GRACE - 1)).toBe(true)
    expect(hasEntitledOwner([], [el], since, GRACE + 200 + GRACE)).toBe(false)
  })

  it('is entitled when any one of several closing overlays is still in grace', () => {
    const stalled = overlay()
    const fresh = overlay()
    const since = new WeakMap<object, number>()

    hasEntitledOwner([], [stalled], since, 0)
    expect(hasEntitledOwner([], [stalled], since, GRACE)).toBe(false)
    expect(hasEntitledOwner([], [stalled, fresh], since, GRACE)).toBe(true)
  })
})
