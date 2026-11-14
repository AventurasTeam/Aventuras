// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DeltaReplayError,
  type ChapterDeleteMode,
  type ChapterDeletePreview,
  type ChapterDeleteRefusal,
  type RemoveChapterResult,
} from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { generationStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

import { chapterDeleteRefusalCopy, useChapterDeleteConfirm } from './use-chapter-delete-confirm'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))

type LoadPreview = (chapterId: string) => Promise<ChapterDeletePreview | ChapterDeleteRefusal>
type Remove = (chapterId: string, mode: ChapterDeleteMode) => Promise<RemoveChapterResult>
type Hook = ReturnType<typeof useChapterDeleteConfirm>

const NOT_LATEST = 'This is no longer the latest chapter.'
const FAILED = "Couldn't delete the chapter."

const PREVIEW: ChapterDeletePreview = {
  chapterNumber: 2,
  createdLore: { count: 1, userEdited: false },
  otherChanges: 3,
  turnsSince: 4,
  after: 'waits',
}
const RECOUNTED: ChapterDeletePreview = { ...PREVIEW, otherChanges: 5 }
const STALE: ChapterDeletePreview = { ...PREVIEW, otherChanges: 4 }
const NEWER: ChapterDeletePreview = { ...PREVIEW, chapterNumber: 3, turnsSince: 0 }

function refusal(code: ChapterDeleteRefusal['code']): ChapterDeleteRefusal {
  return { status: 'rejected', code, reason: `refused: ${code}` }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
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
  const remove = vi.fn<Remove>(async () => ({ status: 'ok' }))
  const resync = vi.fn(async (): Promise<unknown> => undefined)
  const { result } = renderHook(() =>
    useChapterDeleteConfirm({ branchId: 'br_1', loadPreview, remove, resync }),
  )
  return { result, loadPreview, remove, resync }
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

describe('useChapterDeleteConfirm: opening and staying true', () => {
  it('opens on the preview, counted at the settle read before its load', async () => {
    const { result, loadPreview } = setup()
    settleARun()
    const settle = generationStore.getSettleCount()

    await openOn(result)

    expect(loadPreview).toHaveBeenCalledWith('chap_2')
    expect(result.current.target).toEqual({
      chapterId: 'chap_2',
      preview: PREVIEW,
      countedAtSettle: settle,
    })
    expect(result.current.pending).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('re-reads the preview when a run settles under the open confirm', async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    loadPreview.mockResolvedValueOnce(RECOUNTED)

    settleARun()

    await waitFor(() => expect(result.current.target?.preview).toEqual(RECOUNTED))
    expect(loadPreview).toHaveBeenCalledTimes(2)
    expect(loadPreview).toHaveBeenLastCalledWith('chap_2')
  })

  it('drops a re-read a newer settle superseded', async () => {
    const { result, loadPreview } = setup()
    await openOn(result)
    const first = deferred<ChapterDeletePreview>()
    const second = deferred<ChapterDeletePreview>()
    loadPreview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    settleARun()
    settleARun()
    expect(loadPreview).toHaveBeenCalledTimes(3)

    await act(async () => {
      second.resolve(RECOUNTED)
    })
    await act(async () => {
      first.resolve(STALE)
    })

    expect(result.current.target?.preview).toEqual(RECOUNTED)
  })

  it('shows the newer of two opens resolving out of order, at its settle', async () => {
    const { result, loadPreview } = setup()
    const first = deferred<ChapterDeletePreview>()
    const second = deferred<ChapterDeletePreview>()
    loadPreview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let firstOpen!: Promise<void>
    let secondOpen!: Promise<void>
    act(() => {
      firstOpen = result.current.open('chap_2')
    })
    settleARun()
    const newerSettle = generationStore.getSettleCount()
    act(() => {
      secondOpen = result.current.open('chap_3')
    })

    await act(async () => {
      second.resolve(NEWER)
      await secondOpen
    })
    await act(async () => {
      first.resolve(PREVIEW)
      await firstOpen
    })

    expect(result.current.target).toEqual({
      chapterId: 'chap_3',
      preview: NEWER,
      countedAtSettle: newerSettle,
    })
    expect(loadPreview).toHaveBeenCalledTimes(2)
  })

  it('stays closed when dismissed during its opening read', async () => {
    const { result, loadPreview } = setup()
    const opening = deferred<ChapterDeletePreview>()
    loadPreview.mockReturnValueOnce(opening.promise)
    let pendingOpen!: Promise<void>
    act(() => {
      pendingOpen = result.current.open('chap_2')
    })

    act(() => result.current.dismiss())
    await act(async () => {
      opening.resolve(PREVIEW)
      await pendingOpen
    })

    expect(result.current.target).toBeNull()
  })

  it('raises no toast for an opening read a dismiss superseded', async () => {
    const { result, loadPreview } = setup()
    const opening = deferred<ChapterDeleteRefusal>()
    loadPreview.mockReturnValueOnce(opening.promise)
    let pendingOpen!: Promise<void>
    act(() => {
      pendingOpen = result.current.open('chap_2')
    })

    act(() => result.current.dismiss())
    await act(async () => {
      opening.resolve(refusal('not-latest'))
      await pendingOpen
    })

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens nothing and toasts when the opening read is refused', async () => {
    const { result, loadPreview } = setup()
    loadPreview.mockResolvedValueOnce(refusal('no-close'))

    await openOn(result)

    expect(result.current.target).toBeNull()
    expect(toast.error).toHaveBeenCalledWith(FAILED)
  })

  it('opens nothing, logs and toasts when the opening read throws', async () => {
    const { result, loadPreview } = setup()
    loadPreview.mockRejectedValueOnce(new Error('database is locked'))

    await openOn(result)

    expect(result.current.target).toBeNull()
    expect(toast.error).toHaveBeenCalledWith(FAILED)
    expect(logger.error).toHaveBeenCalledWith(
      'app.chapter_delete_preview_threw',
      expect.objectContaining({ chapterId: 'chap_2', error: 'database is locked' }),
    )
  })

  it('closes the confirm with its toast when a re-read is refused', async () => {
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
    loadPreview.mockRejectedValueOnce(new Error('database is locked'))

    settleARun()

    await waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        'app.chapter_delete_recount_failed',
        expect.objectContaining({ chapterId: 'chap_2', error: 'database is locked' }),
      ),
    )
    expect(result.current.target?.preview).toEqual(PREVIEW)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('useChapterDeleteConfirm: the removal', () => {
  it('calls remove once for a double confirm, and toasts nothing on ok', async () => {
    const { result, remove } = setup()
    await openOn(result)
    const removal = deferred<RemoveChapterResult>()
    remove.mockReturnValueOnce(removal.promise)
    let first!: Promise<void>
    let second!: Promise<void>

    act(() => {
      first = result.current.confirm('whole')
      second = result.current.confirm('divider-only')
    })

    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('chap_2', 'whole')
    expect(result.current.pending).toBe(true)
    await act(async () => {
      removal.resolve({ status: 'ok' })
      await Promise.all([first, second])
    })
    expect(result.current.target).toBeNull()
    expect(result.current.pending).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('re-reads nothing when a run settles under a running removal', async () => {
    const { result, loadPreview, remove } = setup()
    await openOn(result)
    const removal = deferred<RemoveChapterResult>()
    remove.mockReturnValueOnce(removal.promise)
    let confirming!: Promise<void>
    act(() => {
      confirming = result.current.confirm('whole')
    })

    settleARun()
    await act(async () => {
      removal.resolve({ status: 'ok' })
      await confirming
    })

    expect(loadPreview).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('drops a re-read that resolves while a removal runs', async () => {
    const { result, loadPreview, remove } = setup()
    await openOn(result)
    const reread = deferred<ChapterDeleteRefusal>()
    loadPreview.mockReturnValueOnce(reread.promise)
    settleARun()
    const removal = deferred<RemoveChapterResult>()
    remove.mockReturnValueOnce(removal.promise)
    let confirming!: Promise<void>
    act(() => {
      confirming = result.current.confirm('whole')
    })

    await act(async () => {
      reread.resolve(refusal('not-found'))
    })
    expect(result.current.target?.chapterId).toBe('chap_2')
    expect(toast.error).not.toHaveBeenCalled()

    await act(async () => {
      removal.resolve({ status: 'ok' })
      await confirming
    })
    expect(result.current.target).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('ignores a dismiss while a removal runs', async () => {
    const { result, remove } = setup()
    await openOn(result)
    const removal = deferred<RemoveChapterResult>()
    remove.mockReturnValueOnce(removal.promise)
    let confirming!: Promise<void>
    act(() => {
      confirming = result.current.confirm('divider-only')
    })

    act(() => result.current.dismiss())
    expect(result.current.target?.chapterId).toBe('chap_2')

    await act(async () => {
      removal.resolve({ status: 'ok' })
      await confirming
    })
    expect(result.current.target).toBeNull()
  })

  it('closes and toasts a refused removal', async () => {
    const { result, remove } = setup()
    await openOn(result)
    remove.mockResolvedValueOnce(refusal('not-latest'))

    await act(async () => {
      await result.current.confirm('whole')
    })

    expect(result.current.target).toBeNull()
    expect(result.current.pending).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(NOT_LATEST)
  })

  it('closes with no toast and resyncs once when the delete committed but its store sync failed', async () => {
    const { result, remove, resync } = setup()
    await openOn(result)
    remove.mockRejectedValueOnce(
      new DeltaReplayError('store sync failed', {
        cause: new Error('stale store'),
        actionId: 'act_delete',
        stage: 'store-sync',
      }),
    )

    await act(async () => {
      await result.current.confirm('whole')
    })

    expect(result.current.target).toBeNull()
    expect(resync).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'app.chapter_delete_resynced',
      expect.objectContaining({ chapterId: 'chap_2' }),
    )
  })

  it('logs a resync that fails after a committed delete', async () => {
    const { result, remove, resync } = setup()
    await openOn(result)
    remove.mockRejectedValueOnce(
      new DeltaReplayError('store sync failed', {
        cause: new Error('stale store'),
        actionId: 'act_delete',
        stage: 'store-sync',
      }),
    )
    resync.mockRejectedValueOnce(new Error('read failed'))

    await act(async () => {
      await result.current.confirm('whole')
    })

    expect(logger.error).toHaveBeenCalledWith(
      'app.chapter_delete_resync_failed',
      expect.objectContaining({ chapterId: 'chap_2', error: 'read failed' }),
    )
    expect(toast.error).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('closes, logs and toasts a removal that threw before it committed', async () => {
    const { result, remove, resync } = setup()
    await openOn(result)
    remove.mockRejectedValueOnce(
      new DeltaReplayError('reverse-replay failed', {
        cause: new Error('database is locked'),
        actionId: 'act_delete',
        stage: 'transaction',
      }),
    )

    await act(async () => {
      await result.current.confirm('divider-only')
    })

    expect(result.current.target).toBeNull()
    expect(resync).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(FAILED)
    expect(logger.error).toHaveBeenCalledWith(
      'app.chapter_delete_threw',
      expect.objectContaining({ chapterId: 'chap_2', mode: 'divider-only' }),
    )
  })
})

describe('chapterDeleteRefusalCopy', () => {
  it('names a chapter that is no longer the latest', () => {
    expect(chapterDeleteRefusalCopy('not-latest')).toBe('chapters:deleteConfirm.notLatest')
  })

  it('reports every other refusal as a failed delete', () => {
    for (const code of ['in-flight', 'not-found', 'no-close', 'integrity'] as const)
      expect(chapterDeleteRefusalCopy(code)).toBe('chapters:deleteConfirm.failed')
  })
})
