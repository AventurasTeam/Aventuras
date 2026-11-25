import { describe, expect, it, vi } from 'vitest'
import { claimBackPress, dispatchBackPress } from './backPress'

describe('back press claims', () => {
  it('reports no claim when nothing holds the back press', () => {
    expect(dispatchBackPress()).toBe(false)
  })

  it('hands the press to the latest claim only', () => {
    const outer = vi.fn(() => true)
    const inner = vi.fn(() => true)
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

  it('passes the press on when a claim declines it', () => {
    const outer = vi.fn(() => true)
    const inner = vi.fn(() => false)
    const releaseOuter = claimBackPress(outer)
    const releaseInner = claimBackPress(inner)
    expect(dispatchBackPress()).toBe(true)
    expect(inner).toHaveBeenCalledOnce()
    expect(outer).toHaveBeenCalledOnce()
    releaseInner()
    releaseOuter()
  })

  it('reports no taker when every claim declines', () => {
    const release = claimBackPress(() => false)
    expect(dispatchBackPress()).toBe(false)
    release()
  })

  it('releases a claim out of order without disturbing the others', () => {
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)
    const releaseFirst = claimBackPress(first)
    const releaseSecond = claimBackPress(second)
    releaseFirst()
    dispatchBackPress()
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    releaseSecond()
  })
})
