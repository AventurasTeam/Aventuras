import { describe, it, expect } from 'vitest'
import { isBodyLocked, isWithinCloseGrace } from './scrollLock'
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
