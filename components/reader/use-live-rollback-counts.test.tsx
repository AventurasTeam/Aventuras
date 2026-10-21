// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORY_ENTRY_REJECTION, type RollbackCounts, type StoryEntryRejection } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { generationStore } from '@/lib/stores'

import { reopenAfterRefusal, type ConfirmState } from './confirm-refusal'
import { useLiveRollbackCounts } from './use-live-rollback-counts'

type Load = (branchId: string, targetId: string) => Promise<RollbackCounts | StoryEntryRejection>

const OPENED: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 2 }
const REFUSED_FRESH: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 5 }
const AFTER_PASS: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 7 }
const LATER: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 9 }

function refused<C extends string>(code: C) {
  return { status: 'rejected', code, reason: `refused: ${code}` } as const
}

// As the reader's opener reads it: the settle count first, then the counts.
function opened(): ConfirmState {
  return {
    mode: 'rollback',
    targetId: 'e3',
    targetNumber: 3,
    counts: OPENED,
    countedAtSettle: generationStore.getSettleCount(),
  }
}

function reopened(
  confirmed: ConfirmState,
  refusal: Parameters<typeof reopenAfterRefusal>[0]['refusal'],
) {
  return reopenAfterRefusal({ current: null, confirmed, refusal, stillOnBranch: true })
}

// A falling reversal flag is one of the points settleCount bumps at; it needs no run fixture.
function settleARun() {
  act(() => {
    generationStore.setReversalInProgress(true)
    generationStore.setReversalInProgress(false)
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Models the reader: the modal's state, and onCounts swapping the shown counts in.
function useHarness(
  load: Load,
  onCounts: (counts: RollbackCounts) => void,
  initial: ConfirmState | null,
) {
  const [target, setTarget] = useState<ConfirmState | null>(initial)
  useLiveRollbackCounts({
    branchId: 'br_1',
    target,
    load,
    onCounts: (counts) => {
      onCounts(counts)
      setTarget((prev) => (prev == null ? prev : { ...prev, counts }))
    },
  })
  return { target, setTarget }
}

beforeEach(() => {
  generationStore.__reset()
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useLiveRollbackCounts', () => {
  it('recounts when a run settles while the modal is open', async () => {
    const load = vi.fn<Load>(async () => AFTER_PASS)
    const onCounts = vi.fn()
    const { result } = renderHook(() => useHarness(load, onCounts, opened()))
    // The opener just counted: opening alone reads nothing.
    expect(load).not.toHaveBeenCalled()

    settleARun()

    await waitFor(() => expect(result.current.target?.counts).toEqual(AFTER_PASS))
    expect(load).toHaveBeenCalledWith('br_1', 'e3')
    expect(load).toHaveBeenCalledTimes(1)
  })

  // The opener read its counts before the run settled; the settle lands in the same commit.
  it('recounts when a run settles in the same commit that opens the modal', async () => {
    const load = vi.fn<Load>(async () => AFTER_PASS)
    const { result } = renderHook(() => useHarness(load, vi.fn(), null))
    const confirm = opened()

    act(() => {
      result.current.setTarget(confirm)
      generationStore.setReversalInProgress(true)
      generationStore.setReversalInProgress(false)
    })

    await waitFor(() => expect(result.current.target?.counts).toEqual(AFTER_PASS))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reads nothing while no modal is open', () => {
    const load = vi.fn<Load>(async () => AFTER_PASS)
    renderHook(() => useHarness(load, vi.fn(), null))
    settleARun()
    expect(load).not.toHaveBeenCalled()
  })

  it('drops a recount that resolves after the modal closed', async () => {
    const pending = deferred<RollbackCounts>()
    const load = vi.fn<Load>(() => pending.promise)
    const onCounts = vi.fn()
    const { result } = renderHook(() => useHarness(load, onCounts, opened()))
    settleARun()
    expect(load).toHaveBeenCalledTimes(1)

    act(() => result.current.setTarget(null))
    await act(async () => {
      pending.resolve(AFTER_PASS)
    })

    expect(onCounts).not.toHaveBeenCalled()
  })

  it('lets a later settle supersede a recount still in flight', async () => {
    const first = deferred<RollbackCounts>()
    const second = deferred<RollbackCounts>()
    const load = vi
      .fn<Load>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const onCounts = vi.fn()
    const { result } = renderHook(() => useHarness(load, onCounts, opened()))
    settleARun()
    settleARun()

    await act(async () => {
      second.resolve(LATER)
    })
    await act(async () => {
      first.resolve(AFTER_PASS)
    })

    expect(result.current.target?.counts).toEqual(LATER)
    expect(onCounts).toHaveBeenCalledTimes(1)
  })

  it('keeps the shown counts and logs when the recount is refused', async () => {
    const load = vi.fn<Load>(async () => ({
      status: 'rejected',
      code: 'rollback-floor',
      reason: 'below the rollback floor',
    }))
    const onCounts = vi.fn()
    const { result } = renderHook(() => useHarness(load, onCounts, opened()))

    settleARun()

    await waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        'reader.rollback_recount_rejected',
        expect.objectContaining({ entryId: 'e3', code: 'rollback-floor' }),
      ),
    )
    expect(onCounts).not.toHaveBeenCalled()
    expect(result.current.target?.counts).toEqual(OPENED)
  })

  it('keeps the shown counts and logs when the recount throws', async () => {
    const load = vi.fn<Load>(async () => {
      throw new Error('database is locked')
    })
    const onCounts = vi.fn()
    const { result } = renderHook(() => useHarness(load, onCounts, opened()))

    settleARun()

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        'reader.rollback_recount_failed',
        expect.objectContaining({ entryId: 'e3', error: 'database is locked' }),
      ),
    )
    expect(onCounts).not.toHaveBeenCalled()
    expect(result.current.target?.counts).toEqual(OPENED)
  })

  // AlertDialogAction closes the modal on press; a counts-changed refusal re-opens it on the
  // returned counts, and the re-opened modal stays live.
  it('keeps counts swapped in by a counts-changed refusal live', async () => {
    const load = vi.fn<Load>(async () => AFTER_PASS)
    const confirmed = opened()
    const { result } = renderHook(() => useHarness(load, vi.fn(), confirmed))

    act(() => result.current.setTarget(null))
    act(() =>
      result.current.setTarget(
        reopened(confirmed, {
          status: 'rejected',
          code: STORY_ENTRY_REJECTION.countsChanged,
          reason: 'counts changed',
          counts: REFUSED_FRESH,
        }),
      ),
    )
    expect(load).not.toHaveBeenCalled()
    expect(result.current.target?.counts).toEqual(REFUSED_FRESH)

    settleARun()

    await waitFor(() => expect(result.current.target?.counts).toEqual(AFTER_PASS))
    expect(load).toHaveBeenCalledTimes(1)
  })

  // A refusal that isn't about the counts re-opens the modal too, on the counts the user
  // confirmed (rollback-confirm.md → Edge cases), and that modal stays live.
  it('keeps a modal re-opened by any other refusal live on the confirmed counts', async () => {
    const load = vi.fn<Load>(async () => AFTER_PASS)
    const confirmed = opened()
    const { result } = renderHook(() => useHarness(load, vi.fn(), confirmed))

    act(() => result.current.setTarget(null))
    act(() => result.current.setTarget(reopened(confirmed, refused('in-flight-gated'))))
    expect(result.current.target?.counts).toEqual(OPENED)

    settleARun()

    await waitFor(() => expect(result.current.target?.counts).toEqual(AFTER_PASS))
  })

  // Settles while shut read nothing, but the counts the modal re-opens on predate them.
  it('recounts a modal re-opened after a run settled while it was shut', async () => {
    const load = vi.fn<Load>(async () => AFTER_PASS)
    const confirmed = opened()
    const { result } = renderHook(() => useHarness(load, vi.fn(), confirmed))

    act(() => result.current.setTarget(null))
    settleARun()
    expect(load).not.toHaveBeenCalled()
    act(() => result.current.setTarget(reopened(confirmed, refused('in-flight-gated'))))

    await waitFor(() => expect(result.current.target?.counts).toEqual(AFTER_PASS))
    expect(load).toHaveBeenCalledTimes(1)
  })
})
