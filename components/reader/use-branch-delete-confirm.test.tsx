// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeleteBranchResult } from '@/lib/actions'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { logger } from '@/lib/diagnostics'
import { generationStore, type RunState, type TxState } from '@/lib/stores'
import { toast } from '@/lib/toast'

import { branchDeleteBlockedReason, useBranchDeleteConfirm } from './use-branch-delete-confirm'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))

type Count = (branchId: string) => Promise<number>
type Remove = (branchId: string) => Promise<DeleteBranchResult>
type Hook = ReturnType<typeof useBranchDeleteConfirm>

const READ_FAILED = "Couldn't read the branch. Please try again."
const IN_FLIGHT = 'Generation is in flight. Cancel to edit.'
const UPDATING_MEMORY = 'Updating memory. Cancel to edit.'
const SWAPPING = 'Unavailable while the embedder switch finishes.'
const FORK = { branchId: 'br_fork', name: 'The fork', count: 5 }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const count = vi.fn<Count>(async () => 5)
  const remove = vi.fn<Remove>(async () => ({ status: 'deleted' }))
  const refresh = vi.fn(async (): Promise<void> => {})
  const row = document.createElement('div')
  const focusAfterDelete = { current: row }
  const { result, rerender, unmount } = renderHook(
    ({ active }: { active: boolean }) =>
      useBranchDeleteConfirm({
        storyId: 'story_1',
        active,
        count,
        remove,
        refresh,
        focusAfterDelete,
      }),
    { initialProps: { active: true } },
  )
  return { result, rerender, unmount, count, remove, refresh, row }
}

async function openOn(result: { current: Hook }, branchId = 'br_fork', name = 'The fork') {
  await act(async () => {
    await result.current.open(branchId, name)
  })
}

async function confirmOn(result: { current: Hook }) {
  await act(async () => {
    await result.current.confirm()
  })
}

// A reversal in progress closes the bare gate with no run fixture.
function closeTheGate() {
  act(() => generationStore.setReversalInProgress(true))
}

beforeEach(() => {
  generationStore.__reset()
  vi.mocked(toast.error).mockClear()
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useBranchDeleteConfirm: opening', () => {
  it("opens on the count read, with the row's name and count", async () => {
    const { result, count } = setup()
    await openOn(result)
    expect(count).toHaveBeenCalledWith('br_fork')
    expect(result.current.target).toEqual(FORK)
    expect(result.current.pending).toBe(false)
    expect(result.current.failed).toBe(false)
    expect(result.current.refusal).toBeNull()
    expect(result.current.returnFocusTo.current).toBeNull()
  })

  it('logs, toasts and opens nothing when the count read throws', async () => {
    const { result, count } = setup()
    count.mockRejectedValueOnce(new Error('db gone'))
    await openOn(result)
    expect(result.current.target).toBeNull()
    expect(toast.error).toHaveBeenCalledWith(READ_FAILED)
    expect(logger.error).toHaveBeenCalledWith('app.branch_delete_count_failed', {
      storyId: 'story_1',
      branchId: 'br_fork',
      error: 'db gone',
    })
  })

  it('opens only the latest of two presses whose reads land out of order', async () => {
    const { result, count } = setup()
    const first = deferred<number>()
    const second = deferred<number>()
    count.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let firstOpen!: Promise<void>
    let secondOpen!: Promise<void>
    act(() => {
      firstOpen = result.current.open('br_fork', 'The fork')
    })
    act(() => {
      secondOpen = result.current.open('br_trap', 'The trap')
    })
    await act(async () => {
      second.resolve(2)
      await secondOpen
    })
    await act(async () => {
      first.resolve(7)
      await firstOpen
    })
    expect(result.current.target).toEqual({ branchId: 'br_trap', name: 'The trap', count: 2 })
    expect(count.mock.calls).toEqual([['br_fork'], ['br_trap']])
  })

  it('opens nothing on return for a read the reader lost focus during', async () => {
    const { result, rerender, count } = setup()
    const reading = deferred<number>()
    count.mockReturnValueOnce(reading.promise)
    let opening!: Promise<void>
    act(() => {
      opening = result.current.open('br_fork', 'The fork')
    })
    rerender({ active: false })
    await act(async () => {
      reading.resolve(5)
      await opening
    })
    rerender({ active: true })
    expect(result.current.target).toBeNull()
  })

  it('drops a read still running when it unmounts', async () => {
    const { result, count, unmount } = setup()
    const reading = deferred<number>()
    count.mockReturnValueOnce(reading.promise)
    let opening!: Promise<void>
    act(() => {
      opening = result.current.open('br_fork', 'The fork')
    })
    unmount()
    await act(async () => {
      reading.reject(new Error('late'))
      await opening
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('useBranchDeleteConfirm: the delete', () => {
  it('runs one delete for a double press', async () => {
    const { result, remove } = setup()
    await openOn(result)
    const removal = deferred<DeleteBranchResult>()
    remove.mockReturnValueOnce(removal.promise)
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.confirm()
      second = result.current.confirm()
    })
    expect(result.current.pending).toBe(true)
    await act(async () => {
      removal.resolve({ status: 'deleted' })
      await first
      await second
    })
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('br_fork')
    expect(result.current.pending).toBe(false)
  })

  it('names the current row for focus before the confirm clears', async () => {
    const row = document.createElement('div')
    const seenAsTargetCleared: unknown[] = []
    const { result } = renderHook(() => {
      const hook = useBranchDeleteConfirm({
        storyId: 'story_1',
        active: true,
        count: async () => 5,
        remove: async () => ({ status: 'deleted' }),
        refresh: async () => {},
        focusAfterDelete: { current: row },
      })
      if (hook.target == null) seenAsTargetCleared.push(hook.returnFocusTo.current)
      return hook
    })
    await openOn(result)
    seenAsTargetCleared.length = 0
    await confirmOn(result)
    expect(result.current.target).toBeNull()
    // The first render without a target already names the row: the confirm unmounts in it.
    expect(seenAsTargetCleared[0]).toBe(row)
  })

  it('forgets the row on the next open, so its Cancel returns to the delete control', async () => {
    const { result, row } = setup()
    await openOn(result)
    await confirmOn(result)
    expect(result.current.returnFocusTo.current).toBe(row)
    await openOn(result, 'br_trap', 'The trap')
    expect(result.current.returnFocusTo.current).toBeNull()
  })

  it('forgets the row on a dismiss', async () => {
    const { result, row } = setup()
    await openOn(result)
    await confirmOn(result)
    expect(result.current.returnFocusTo.current).toBe(row)
    act(() => result.current.dismiss())
    expect(result.current.returnFocusTo.current).toBeNull()
  })

  it.each(['missing', 'current'] as const)(
    'closes on a %s refusal and refreshes the rows',
    async (code) => {
      const { result, remove, refresh } = setup()
      await openOn(result)
      remove.mockResolvedValueOnce({ status: 'rejected', code })
      await confirmOn(result)
      expect(result.current.target).toBeNull()
      expect(result.current.refusal).toBeNull()
      expect(result.current.returnFocusTo.current).toBeNull()
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it.each(['gated', 'swap-pending'] as const)(
    'keeps the confirm on a %s refusal, holding the code for its line',
    async (code) => {
      const { result, remove, refresh } = setup()
      await openOn(result)
      closeTheGate()
      remove.mockResolvedValueOnce({ status: 'rejected', code })
      await confirmOn(result)
      expect(result.current.target).toEqual(FORK)
      expect(result.current.refusal).toBe(code)
      expect(result.current.pending).toBe(false)
      expect(result.current.failed).toBe(false)
      expect(refresh).not.toHaveBeenCalled()
    },
  )

  it('lets a gate refusal go once the gate opens, so Delete branch is live again', async () => {
    const { result, remove } = setup()
    await openOn(result)
    closeTheGate()
    remove.mockResolvedValueOnce({ status: 'rejected', code: 'gated' })
    await confirmOn(result)
    expect(result.current.refusal).toBe('gated')
    act(() => generationStore.setReversalInProgress(false))
    expect(result.current.refusal).toBeNull()
    expect(result.current.target).toEqual(FORK)
  })

  it("keeps a swap refusal when the gate opens: only the gate's follows the gate", async () => {
    const { result, remove } = setup()
    await openOn(result)
    closeTheGate()
    remove.mockResolvedValueOnce({ status: 'rejected', code: 'swap-pending' })
    await confirmOn(result)
    act(() => generationStore.setReversalInProgress(false))
    expect(result.current.refusal).toBe('swap-pending')
  })

  it('marks a thrown delete failed and keeps the confirm; a retry clears the line', async () => {
    const { result, remove } = setup()
    await openOn(result)
    remove.mockRejectedValueOnce(new Error('disk full'))
    await confirmOn(result)
    expect(result.current.failed).toBe(true)
    expect(result.current.target).toEqual(FORK)
    expect(result.current.returnFocusTo.current).toBeNull()
    expect(logger.error).toHaveBeenCalledWith('app.branch_delete_threw', {
      storyId: 'story_1',
      branchId: 'br_fork',
      error: 'disk full',
    })

    const retry = deferred<DeleteBranchResult>()
    remove.mockReturnValueOnce(retry.promise)
    let pressed!: Promise<void>
    act(() => {
      pressed = result.current.confirm()
    })
    expect(result.current.failed).toBe(false)
    await act(async () => {
      retry.resolve({ status: 'deleted' })
      await pressed
    })
    expect(result.current.target).toBeNull()
  })

  it('ignores a dismiss while the delete runs', async () => {
    const { result, remove } = setup()
    await openOn(result)
    const removal = deferred<DeleteBranchResult>()
    remove.mockReturnValueOnce(removal.promise)
    let pressed!: Promise<void>
    act(() => {
      pressed = result.current.confirm()
    })
    act(() => result.current.dismiss())
    expect(result.current.target).toEqual(FORK)
    await act(async () => {
      removal.resolve({ status: 'deleted' })
      await pressed
    })
  })

  it('dismisses when the reader loses focus', async () => {
    const { result, rerender } = setup()
    await openOn(result)
    rerender({ active: false })
    expect(result.current.target).toBeNull()
  })

  it('holds a running delete through a focus loss, then dismisses what it left open', async () => {
    const { result, rerender, remove } = setup()
    await openOn(result)
    closeTheGate()
    const removal = deferred<DeleteBranchResult>()
    remove.mockReturnValueOnce(removal.promise)
    let pressed!: Promise<void>
    act(() => {
      pressed = result.current.confirm()
    })
    rerender({ active: false })
    expect(result.current.target).toEqual(FORK)
    expect(result.current.pending).toBe(true)
    await act(async () => {
      removal.resolve({ status: 'rejected', code: 'gated' })
      await pressed
    })
    expect(result.current.target).toBeNull()
  })
})

function memoryRun(): RunState {
  return {
    runId: 'run_memory',
    kind: PERIODIC_CLASSIFIER_KIND,
    gateBehavior: 'hard-gate',
    interruptible: 'pass',
    beforeTurn: false,
    actionId: 'act_memory',
    storyId: 'story_1',
    branchId: 'br_main',
    abortController: new AbortController(),
    currentPhase: 'running',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

function blockedReason(
  overrides: Partial<Parameters<typeof branchDeleteBlockedReason>[0]> = {},
): string | undefined {
  return branchDeleteBlockedReason({
    txState: generationStore.getTxState(),
    storyId: 'story_1',
    switchPaused: false,
    swapPending: false,
    refusal: null,
    ...overrides,
  })
}

describe('branchDeleteBlockedReason', () => {
  // A held current branch leaves a delete open, so the reason is the run's.
  it("names the story's run, not a hold on the current branch", () => {
    const txState: TxState = {
      ...generationStore.getTxState(),
      runs: new Map([['run_memory', memoryRun()]]),
      heldBranches: new Map([['br_main', { storyId: 'story_1' }]]),
    }
    expect(blockedReason({ txState, switchPaused: true })).toBe(UPDATING_MEMORY)
  })

  it("names the gate's own reason for a pause with no run", () => {
    expect(blockedReason({ switchPaused: true })).toBe(IN_FLIGHT)
  })

  it('names the swap while one is pending', () => {
    expect(blockedReason({ swapPending: true })).toBe(SWAPPING)
  })

  it('puts the gate ahead of the swap', () => {
    expect(blockedReason({ switchPaused: true, swapPending: true })).toBe(IN_FLIGHT)
  })

  it('falls back to the refusal the press met', () => {
    expect(blockedReason({ refusal: 'gated' })).toBe(IN_FLIGHT)
    expect(blockedReason({ refusal: 'swap-pending' })).toBe(SWAPPING)
  })

  it('gives nothing while nothing blocks', () => {
    expect(blockedReason()).toBeUndefined()
  })
})
