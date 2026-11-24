// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { logger } from '@/lib/diagnostics'

import { useEmptyAfterRowsSignal } from './use-empty-after-rows-signal'

let debugSpy: MockInstance<typeof logger.debug>

beforeEach(() => {
  debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  debugSpy.mockRestore()
})

const emptyLogs = () => debugSpy.mock.calls.filter(([kind]) => kind === 'reader.empty_after_rows')

type Props = { branchId: string; hydrated: boolean; rows: number }

function setup(initial: Props) {
  return renderHook(
    ({ branchId, hydrated, rows }: Props) => useEmptyAfterRowsSignal(branchId, hydrated, rows),
    { initialProps: initial },
  )
}

describe('useEmptyAfterRowsSignal', () => {
  it('logs once, with the branch, when rows drop to zero after rows were shown', () => {
    const { rerender } = setup({ branchId: 'br_a', hydrated: true, rows: 3 })
    expect(emptyLogs()).toEqual([])
    rerender({ branchId: 'br_a', hydrated: true, rows: 0 })
    expect(emptyLogs()).toEqual([['reader.empty_after_rows', { branchId: 'br_a' }]])
  })

  it('does not log for a branch that was empty from the start', () => {
    const { rerender } = setup({ branchId: 'br_a', hydrated: true, rows: 0 })
    rerender({ branchId: 'br_a', hydrated: true, rows: 0 })
    expect(emptyLogs()).toEqual([])
  })

  it('does not log while hydration has not succeeded, even after rows', () => {
    const { rerender } = setup({ branchId: 'br_a', hydrated: true, rows: 2 })
    rerender({ branchId: 'br_a', hydrated: false, rows: 0 })
    expect(emptyLogs()).toEqual([])
  })

  it('logs again for a second drop to zero after rows return', () => {
    const { rerender } = setup({ branchId: 'br_a', hydrated: true, rows: 2 })
    rerender({ branchId: 'br_a', hydrated: true, rows: 0 })
    rerender({ branchId: 'br_a', hydrated: true, rows: 1 })
    rerender({ branchId: 'br_a', hydrated: true, rows: 0 })
    expect(emptyLogs()).toHaveLength(2)
  })
})
