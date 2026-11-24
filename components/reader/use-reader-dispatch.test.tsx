// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readerHoldStore } from '@/lib/stores'

import { useReaderDispatch } from './use-reader-dispatch'

const BRANCH = 'br_reader'
const OTHER = 'br_other'

beforeEach(() => {
  readerHoldStore.__reset()
})

afterEach(() => {
  cleanup()
  readerHoldStore.__reset()
})

describe('useReaderDispatch', () => {
  it('marks one dispatch and refuses a second while it is in flight', () => {
    const { result } = renderHook(() => useReaderDispatch(BRANCH))
    let first = false
    let second = true
    act(() => {
      first = result.current.begin()
    })
    act(() => {
      second = result.current.begin()
    })
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('takes a new dispatch once the last one ends', () => {
    const { result } = renderHook(() => useReaderDispatch(BRANCH))
    act(() => {
      result.current.begin()
    })
    act(() => {
      result.current.end()
    })
    expect(result.current.isBlocked()).toBe(false)
    let again = false
    act(() => {
      again = result.current.begin()
    })
    expect(again).toBe(true)
  })

  it('refuses a dispatch while the branch is held, marking nothing', () => {
    const { result } = renderHook(() => useReaderDispatch(BRANCH))
    const token = readerHoldStore.take(BRANCH)
    let began = true
    act(() => {
      began = result.current.begin()
    })
    expect(began).toBe(false)
    expect(result.current.inFlight).toBe(false)
    act(() => readerHoldStore.release(token))
    expect(result.current.isBlocked()).toBe(false)
  })

  it('is blocked while a dispatch is in flight, and not otherwise', () => {
    const { result } = renderHook(() => useReaderDispatch(BRANCH))
    expect(result.current.isBlocked()).toBe(false)
    act(() => {
      result.current.begin()
    })
    expect(result.current.isBlocked()).toBe(true)
  })

  it('is blocked while the branch is held, and not by a hold on another branch', () => {
    const { result } = renderHook(() => useReaderDispatch(BRANCH))
    readerHoldStore.take(OTHER)
    expect(result.current.isBlocked()).toBe(false)
    readerHoldStore.take(BRANCH)
    expect(result.current.isBlocked()).toBe(true)
  })

  it('reads the hold live: a take after the render shows without a re-render', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useReaderDispatch(BRANCH)
    })
    const { isHeld, isBlocked } = result.current
    const rendersBefore = renders
    readerHoldStore.take(BRANCH)
    expect(renders).toBe(rendersBefore)
    expect(isHeld()).toBe(true)
    expect(isBlocked()).toBe(true)
  })

  it('reports the hold and the in-flight mark as state a render reads', () => {
    const { result } = renderHook(() => useReaderDispatch(BRANCH))
    expect(result.current.held).toBe(false)
    expect(result.current.inFlight).toBe(false)

    act(() => {
      readerHoldStore.take(BRANCH)
    })
    expect(result.current.held).toBe(true)
    act(() => readerHoldStore.clear(BRANCH))
    expect(result.current.held).toBe(false)

    act(() => {
      result.current.begin()
    })
    expect(result.current.inFlight).toBe(true)
    act(() => {
      result.current.end()
    })
    expect(result.current.inFlight).toBe(false)
  })

  it("ends the branch's hold when the reader unmounts, and leaves another branch's", () => {
    const { unmount } = renderHook(() => useReaderDispatch(BRANCH))
    readerHoldStore.take(BRANCH)
    readerHoldStore.take(OTHER)
    unmount()
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
    expect(readerHoldStore.isHeld(OTHER)).toBe(true)
  })
})
