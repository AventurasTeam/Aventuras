import { describe, expect, it, vi } from 'vitest'
import { claimBackPress, dispatchBackPress } from './backPress'

describe('back press claims', () => {
  it('reports no claim when nothing holds the back press', () => {
    expect(dispatchBackPress()).toBe(false)
  })

  it('hands the press to the latest claim only', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const releaseOuter = claimBackPress(outer)
    const releaseInner = claimBackPress(inner)
    expect(dispatchBackPress()).toBe(true)
    expect(inner).toHaveBeenCalledOnce()
    expect(outer).not.toHaveBeenCalled()
    releaseInner()
    dispatchBackPress()
    expect(outer).toHaveBeenCalledOnce()
    releaseOuter()
    expect(dispatchBackPress()).toBe(false)
  })

  it('releases a claim out of order without disturbing the others', () => {
    const first = vi.fn()
    const second = vi.fn()
    const releaseFirst = claimBackPress(first)
    const releaseSecond = claimBackPress(second)
    releaseFirst()
    dispatchBackPress()
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    releaseSecond()
  })
})
