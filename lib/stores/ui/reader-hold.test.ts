// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetAllStores } from '@/lib/stores'

import { readerHoldStore, type ReaderHoldToken } from './reader-hold'

beforeEach(() => {
  readerHoldStore.__reset()
})

afterEach(() => {
  cleanup()
})

describe('readerHoldStore', () => {
  it('holds the branch it was taken for and no other, until its release', () => {
    const token = readerHoldStore.take('br_1')
    expect(token).toEqual({ branchId: 'br_1' })
    expect(readerHoldStore.isHeld('br_1')).toBe(true)
    expect(readerHoldStore.isHeld('br_2')).toBe(false)

    readerHoldStore.release(token)

    expect(readerHoldStore.isHeld('br_1')).toBe(false)
  })

  it("keeps a newer take when an older one's release lands, and the older when the newer's does", () => {
    const older = readerHoldStore.take('br_1')
    const newer = readerHoldStore.take('br_1')
    readerHoldStore.release(older)
    expect(readerHoldStore.isHeld('br_1')).toBe(true)
    readerHoldStore.release(newer)
    expect(readerHoldStore.isHeld('br_1')).toBe(false)

    const first = readerHoldStore.take('br_1')
    const second = readerHoldStore.take('br_1')
    readerHoldStore.release(second)
    expect(readerHoldStore.isHeld('br_1')).toBe(true)
    readerHoldStore.release(first)
    expect(readerHoldStore.isHeld('br_1')).toBe(false)
  })

  it('ignores a second release of one token', () => {
    const released = readerHoldStore.take('br_1')
    readerHoldStore.release(released)
    readerHoldStore.take('br_1')

    readerHoldStore.release(released)

    expect(readerHoldStore.isHeld('br_1')).toBe(true)
  })

  it("ends every token on the branch on clear, and leaves another branch's", () => {
    const token = readerHoldStore.take('br_1')
    readerHoldStore.take('br_1')
    readerHoldStore.take('br_2')

    readerHoldStore.clear('br_1')

    expect(readerHoldStore.isHeld('br_1')).toBe(false)
    expect(readerHoldStore.isHeld('br_2')).toBe(true)
    readerHoldStore.release(token)
    expect(readerHoldStore.isHeld('br_1')).toBe(false)
  })

  it('empties on resetAllStores', () => {
    readerHoldStore.take('br_1')

    resetAllStores()

    expect(readerHoldStore.isHeld('br_1')).toBe(false)
  })

  it("re-renders a reader on its own branch's hold only", () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return readerHoldStore.useHeld('br_1')
    })
    expect(result.current).toBe(false)

    let token!: ReaderHoldToken
    act(() => {
      token = readerHoldStore.take('br_1')
    })
    expect(result.current).toBe(true)

    const before = renders
    act(() => {
      readerHoldStore.take('br_2')
    })
    expect(renders).toBe(before)

    act(() => readerHoldStore.release(token))
    expect(result.current).toBe(false)
  })
})
