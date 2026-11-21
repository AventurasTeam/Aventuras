// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CloseRerunPreview,
  CloseRerunReadRefusal,
  CloseRerunRefusalCode,
  RollbackCounts,
} from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { generationStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

import { useCloseRerunConfirm } from './use-close-rerun-confirm'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))

type LoadPreview = (chapterId: string) => Promise<CloseRerunPreview | CloseRerunReadRefusal>
type Hook = ReturnType<typeof useCloseRerunConfirm>

const NOT_LATEST = 'This is no longer the latest chapter.'
const CLOSE_OWED = 'Close the open chapter first.'
const READ_FAILED = "Couldn't read what a re-run would change."

const COUNTS: RollbackCounts = {
  entries: 6,
  chapters: 0,
  worldStateChanges: 12,
  closeWrites: 0,
  reopenedChapter: null,
  removedChapters: [],
}
const PREVIEW: CloseRerunPreview = {
  chapterNumber: 2,
  model: 'gemma-4-26b',
  tokens: 24310,
  reversal: { createdLore: { count: 2, userEdited: false }, otherChanges: 31 },
  shortcut: {
    targetEntryId: 'ent_58',
    turns: 3,
    entries: { count: 6, first: 58, last: 63 },
    counts: COUNTS,
  },
}
const RECOUNTED: CloseRerunPreview = {
  ...PREVIEW,
  reversal: { ...PREVIEW.reversal, otherChanges: 33 },
}
const STALE: CloseRerunPreview = { ...PREVIEW, reversal: { ...PREVIEW.reversal, otherChanges: 32 } }
const FRESH: CloseRerunPreview = { ...PREVIEW, shortcut: null }

function refusal(code: CloseRerunRefusalCode): CloseRerunReadRefusal {
  return { status: 'rejected', code, reason: `refused: ${code}` }
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

// A falling reversal flag is one of the points settleCount bumps at; it needs no run fixture.
function settleARun() {
  act(() => {
    generationStore.setReversalInProgress(true)
    generationStore.setReversalInProgress(false)
  })
}

function setup() {
  const loadPreview = vi.fn<LoadPreview>(async () => PREVIEW)
  const { result, rerender, unmount } = renderHook(
    ({ active }: { active: boolean }) =>
      useCloseRerunConfirm({ branchId: 'br_1', active, loadPreview }),
    { initialProps: { active: true } },
  )
  return { result, rerender, unmount, loadPreview }
}

async function openOn(result: { current: Hook }, chapterId = 'chap_2') {
  await act(async () => {
    await result.current.open(chapterId)
  })
}

beforeEach(() => {
  generationStore.__reset()
  vi.mocked(toast.error).mockClear()
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useCloseRerunConfirm: opening', () => {
  it('opens on the preview', async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    expect(loadPreview).toHaveBeenCalledWith('chap_2')
    expect(result.current.target).toEqual({ chapterId: 'chap_2', preview: PREVIEW })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['not-latest', NOT_LATEST],
    ['close-owed', CLOSE_OWED],
    ['no-close', READ_FAILED],
    ['not-found', READ_FAILED],
    ['integrity', READ_FAILED],
  ] as const)('opens nothing and toasts a %s refusal', async (code, copy) => {
    const { result, loadPreview } = setup()
    loadPreview.mockResolvedValueOnce(refusal(code))
    await openOn(result)
    expect(result.current.target).toBeNull()
    expect(toast.error).toHaveBeenCalledWith(copy)
  })

  // A missing close or chapter is a broken log or a stale card; the rest are races or logged elsewhere.
  it('logs a refusal that means a broken log or a stale card', async () => {
    const { result, loadPreview } = setup()
    loadPreview
      .mockResolvedValueOnce(refusal('no-close'))
      .mockResolvedValueOnce(refusal('not-latest'))
    await openOn(result)
    await openOn(result)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith('app.close_rerun_preview_refused', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      code: 'no-close',
    })
  })

  it('opens nothing, logs and toasts when the opening read throws', async () => {
    const { result, loadPreview } = setup()
    loadPreview.mockRejectedValueOnce(new Error('database is locked'))
    await openOn(result)
    expect(result.current.target).toBeNull()
    expect(logger.error).toHaveBeenCalledWith('app.close_rerun_preview_threw', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      error: 'database is locked',
    })
    expect(toast.error).toHaveBeenCalledWith(READ_FAILED)
  })

  it('shows the newer of two opens resolving out of order', async () => {
    const { result, loadPreview } = setup()
    const older = deferred<CloseRerunPreview>()
    loadPreview.mockReturnValueOnce(older.promise).mockResolvedValueOnce(RECOUNTED)
    let first!: Promise<void>
    act(() => {
      first = result.current.open('chap_2')
    })
    await openOn(result, 'chap_3')
    await act(async () => {
      older.resolve(PREVIEW)
      await first
    })
    expect(result.current.target).toEqual({ chapterId: 'chap_3', preview: RECOUNTED })
  })

  it('re-reads when a run settles during the opening read', async () => {
    const { result, loadPreview } = setup()
    const opening = deferred<CloseRerunPreview>()
    loadPreview.mockReturnValueOnce(opening.promise).mockResolvedValueOnce(RECOUNTED)
    let pendingOpen!: Promise<void>
    act(() => {
      pendingOpen = result.current.open('chap_2')
    })

    settleARun()
    await act(async () => {
      opening.resolve(PREVIEW)
      await pendingOpen
    })

    await waitFor(() => expect(result.current.target?.preview).toEqual(RECOUNTED))
    expect(loadPreview).toHaveBeenCalledTimes(2)
  })

  it('opens nothing for an opening read that resolves after the host let go', async () => {
    const { result, rerender, loadPreview } = setup()
    const pending = deferred<CloseRerunPreview>()
    loadPreview.mockReturnValueOnce(pending.promise)
    let opening!: Promise<void>
    act(() => {
      opening = result.current.open('chap_2')
    })
    rerender({ active: false })
    await act(async () => {
      pending.resolve(PREVIEW)
      await opening
    })
    expect(result.current.target).toBeNull()
  })

  it('closes when the host lets go', async () => {
    const { result, rerender } = setup()
    await openOn(result)
    rerender({ active: false })
    expect(result.current.target).toBeNull()
  })
})

describe('useCloseRerunConfirm: staying true', () => {
  it('re-reads the preview when a run settles under it', async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    loadPreview.mockResolvedValueOnce(RECOUNTED)

    settleARun()

    await waitFor(() => expect(result.current.target?.preview).toEqual(RECOUNTED))
    expect(loadPreview).toHaveBeenCalledTimes(2)
  })

  it('drops a re-read a newer settle superseded', async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    const first = deferred<CloseRerunPreview>()
    const second = deferred<CloseRerunPreview>()
    loadPreview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    settleARun()
    settleARun()

    await act(async () => {
      second.resolve(RECOUNTED)
    })
    await act(async () => {
      first.resolve(STALE)
    })

    expect(result.current.target?.preview).toEqual(RECOUNTED)
  })

  it("closes with the refusal's toast when a re-read is refused", async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    loadPreview.mockResolvedValueOnce(refusal('not-latest'))

    settleARun()

    await waitFor(() => expect(result.current.target).toBeNull())
    expect(toast.error).toHaveBeenCalledWith(NOT_LATEST)
  })

  it('keeps the shown preview and logs when a re-read throws', async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    loadPreview.mockRejectedValueOnce(new Error('disk'))

    settleARun()

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith('app.close_rerun_recount_failed', {
        branchId: 'br_1',
        chapterId: 'chap_2',
        error: 'disk',
      }),
    )
    expect(result.current.target?.preview).toEqual(PREVIEW)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('takes a preview the host replaces, and keeps it over a re-read begun before it', async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    const reading = deferred<CloseRerunPreview>()
    loadPreview.mockReturnValueOnce(reading.promise)
    settleARun()

    act(() => result.current.replace(FRESH))
    await act(async () => {
      reading.resolve(RECOUNTED)
    })

    expect(result.current.target).toEqual({ chapterId: 'chap_2', preview: FRESH })
  })

  it('re-reads a replaced preview at the next settle', async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    act(() => result.current.replace(FRESH))
    loadPreview.mockResolvedValueOnce(RECOUNTED)

    settleARun()

    await waitFor(() => expect(result.current.target?.preview).toEqual(RECOUNTED))
  })

  it('replaces nothing while nothing is open', () => {
    const { result } = setup()
    act(() => result.current.replace(FRESH))
    expect(result.current.target).toBeNull()
  })

  it("reads nothing while a re-run's chain holds the branch: its end decides the confirm", async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    act(() => generationStore.setPendingRerun('br_1', { chapterId: 'chap_2' }))

    settleARun()

    expect(loadPreview).toHaveBeenCalledTimes(1)
    expect(result.current.target?.preview).toEqual(PREVIEW)
  })

  it("drops a re-read that lands after a re-run's chain began", async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    const reading = deferred<CloseRerunPreview>()
    loadPreview.mockReturnValueOnce(reading.promise)
    settleARun()

    act(() => generationStore.setPendingRerun('br_1', { chapterId: 'chap_2' }))
    await act(async () => {
      reading.resolve(RECOUNTED)
    })

    expect(result.current.target?.preview).toEqual(PREVIEW)
  })

  // The shortcut's prose reversal settles under the start's pending mark.
  it('reads nothing for a settle under a pending mark on the branch', async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    const release = deferred<void>()
    let marked!: Promise<void>
    act(() => {
      marked = generationStore.bracketPendingTurn('br_1', () => release.promise)
    })

    settleARun()

    expect(loadPreview).toHaveBeenCalledTimes(1)
    await act(async () => {
      release.resolve()
      await marked
    })
  })
})
