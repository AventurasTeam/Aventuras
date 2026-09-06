import { describe, it, expect } from 'vitest'
import { isBodyLocked } from './scrollLock'

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
