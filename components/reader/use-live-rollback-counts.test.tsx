// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORY_ENTRY_REJECTION, type RollbackCounts, type StoryEntryRejection } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { generationStore } from '@/lib/stores'

import { countsAfterRefusal, useLiveRollbackCounts } from './use-live-rollback-counts'

type Target = { targetId: string; counts: RollbackCounts }
type Load = (branchId: string, targetId: string) => Promise<RollbackCounts | StoryEntryRejection>

const OPENED: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 2 }
const REFUSED_FRESH: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 5 }
const AFTER_PASS: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 7 }
const LATER: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 9 }

function refused<C extends string>(code: C) {
  return { status: 'rejected', code, reason: `refused: ${code}` } as const
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
  initial: Target | null,
) {
  const [target, setTarget] = useState<Target | null>(initial)
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
    const { result } = renderHook(() =>
      useHarness(load, onCounts, { targetId: 'e3', counts: OPENED }),
    )
    // The opener just counted: opening alone reads nothing.
    expect(load).not.toHaveBeenCalled()

    settleARun()

    await waitFor(() => expect(result.current.target?.counts).toEqual(AFTER_PASS))
    expect(load).toHaveBeenCalledWith('br_1', 'e3')
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
    const { result } = renderHook(() =>
      useHarness(load, onCounts, { targetId: 'e3', counts: OPENED }),
    )
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
    const { result } = renderHook(() =>
      useHarness(load, onCounts, { targetId: 'e3', counts: OPENED }),
    )
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
    const { result } = renderHook(() =>
      useHarness(load, onCounts, { targetId: 'e3', counts: OPENED }),
    )

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
    const { result } = renderHook(() =>
      useHarness(load, onCounts, { targetId: 'e3', counts: OPENED }),
    )

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
  // returned counts. Settles while shut read nothing, and the re-opened modal stays live.
  it('keeps counts swapped in by a counts-changed refusal live', async () => {
    const load = vi.fn<Load>(async () => AFTER_PASS)
    const onCounts = vi.fn()
    const { result } = renderHook(() =>
      useHarness(load, onCounts, { targetId: 'e3', counts: OPENED }),
    )

    act(() => result.current.setTarget(null))
    settleARun()
    act(() => result.current.setTarget({ targetId: 'e3', counts: REFUSED_FRESH }))
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
    const { result } = renderHook(() =>
      useHarness(load, vi.fn(), { targetId: 'e3', counts: OPENED }),
    )

    act(() => result.current.setTarget(null))
    act(() =>
      result.current.setTarget({
        targetId: 'e3',
        counts: countsAfterRefusal(OPENED, refused('in-flight-gated')),
      }),
    )
    expect(result.current.target?.counts).toEqual(OPENED)

    settleARun()

    await waitFor(() => expect(result.current.target?.counts).toEqual(AFTER_PASS))
  })
})

describe('countsAfterRefusal', () => {
  it('re-opens a counts-changed refusal on the counts the action returned', () => {
    expect(
      countsAfterRefusal(OPENED, {
        status: 'rejected',
        code: STORY_ENTRY_REJECTION.countsChanged,
        reason: 'counts changed',
        counts: REFUSED_FRESH,
      }),
    ).toEqual(REFUSED_FRESH)
  })

  it('re-opens any other refusal on the counts the user confirmed', () => {
    expect(countsAfterRefusal(OPENED, refused('in-flight-gated'))).toBe(OPENED)
    expect(countsAfterRefusal(OPENED, refused('generation-in-flight'))).toBe(OPENED)
    expect(countsAfterRefusal(OPENED, refused('sweep-refused'))).toBe(OPENED)
  })

  it('takes no counts-changed refusal without its counts', () => {
    // @ts-expect-error a counts-changed refusal always carries the counts it found
    countsAfterRefusal(OPENED, refused(STORY_ENTRY_REJECTION.countsChanged))
  })
})
