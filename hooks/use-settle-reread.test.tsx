// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generationStore } from '@/lib/stores'

import { useSettleReread } from './use-settle-reread'

type Props = {
  targetKey: string | null
  countedAtSettle: number | null
  onSettle: (isLive: () => boolean) => void
}

// A falling reversal flag is one of the points settleCount bumps at; it needs no run fixture.
function settleARun() {
  act(() => {
    generationStore.setReversalInProgress(true)
    generationStore.setReversalInProgress(false)
  })
}

function setup(initial: Props) {
  return renderHook((props: Props) => useSettleReread(props), { initialProps: initial })
}

beforeEach(() => {
  generationStore.__reset()
})
afterEach(() => {
  cleanup()
})

describe('useSettleReread', () => {
  it('calls nothing while the host shows nothing', () => {
    const onSettle = vi.fn()
    setup({ targetKey: null, countedAtSettle: null, onSettle })
    settleARun()
    expect(onSettle).not.toHaveBeenCalled()
  })

  it('calls nothing for the settle the shown data was read at', () => {
    const onSettle = vi.fn()
    settleARun()
    setup({ targetKey: 'a', countedAtSettle: generationStore.getSettleCount(), onSettle })
    expect(onSettle).not.toHaveBeenCalled()
  })

  it('calls once for each settle past the counted one', () => {
    const onSettle = vi.fn()
    setup({ targetKey: 'a', countedAtSettle: generationStore.getSettleCount(), onSettle })
    settleARun()
    settleARun()
    expect(onSettle).toHaveBeenCalledTimes(2)
  })

  // The host read its data, then a run settled before the render that shows it.
  it('calls at once when a run settled between the read and the showing', () => {
    const onSettle = vi.fn()
    const counted = generationStore.getSettleCount()
    settleARun()
    setup({ targetKey: 'a', countedAtSettle: counted, onSettle })
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  it('turns a read dead once a newer settle supersedes it', () => {
    const lives: (() => boolean)[] = []
    setup({
      targetKey: 'a',
      countedAtSettle: generationStore.getSettleCount(),
      onSettle: (isLive) => lives.push(isLive),
    })
    settleARun()
    settleARun()
    expect(lives.map((isLive) => isLive())).toEqual([false, true])
  })

  it('turns a read dead once the host closes, and calls nothing after', () => {
    const lives: (() => boolean)[] = []
    const onSettle = (isLive: () => boolean) => lives.push(isLive)
    const counted = generationStore.getSettleCount()
    const { rerender } = setup({ targetKey: 'a', countedAtSettle: counted, onSettle })
    settleARun()

    rerender({ targetKey: null, countedAtSettle: null, onSettle })
    settleARun()

    expect(lives).toHaveLength(1)
    expect(lives[0]?.()).toBe(false)
  })

  it('turns a read dead once the target changes, and reads for the new one', () => {
    const lives: (() => boolean)[] = []
    const onSettle = (isLive: () => boolean) => lives.push(isLive)
    const counted = generationStore.getSettleCount()
    const { rerender } = setup({ targetKey: 'a', countedAtSettle: counted, onSettle })
    settleARun()

    rerender({ targetKey: 'b', countedAtSettle: counted, onSettle })

    expect(lives.map((isLive) => isLive())).toEqual([false, true])
  })

  it('calls the callback of the latest render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const counted = generationStore.getSettleCount()
    const { rerender } = setup({ targetKey: 'a', countedAtSettle: counted, onSettle: first })
    rerender({ targetKey: 'a', countedAtSettle: counted, onSettle: second })
    settleARun()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
