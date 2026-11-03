// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { useCallback, useLayoutEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { branches, stories, storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { entriesStore } from '@/lib/stores'

import { useReaderEntryJump } from './use-reader-entry-jump'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

const BRANCH = 'br_reader_jump'

const row = (position: number): StoryEntry => ({
  id: `entry_${position}`,
  branchId: BRANCH,
  position,
  kind: 'user_action',
  content: `Entry ${position}`,
  contentTokens: null,
  chapterId: null,
  metadata: null,
  createdAt: position,
})

// 120 rows, the newest 50 in the store: entry_100 is in the window and entry_10 isn't.
async function seedBranch(): Promise<DbCtx> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's_reader_jump', title: 'T', createdAt: 1, updatedAt: 1 })
  await db
    .insert(branches)
    .values({ id: BRANCH, storyId: 's_reader_jump', name: 'main', createdAt: 1 })
  const rows = Array.from({ length: 120 }, (_, i) => row(i + 1))
  await db.insert(storyEntries).values(rows)
  entriesStore.hydrate(BRANCH, rows.slice(-50))
  return { db, runInTransaction }
}

describe('useReaderEntryJump', () => {
  const send = vi.fn<(entryId: string) => void>()
  let ctx: DbCtx

  const mount = (ready: boolean) =>
    renderHook(({ branchId, ready }) => useReaderEntryJump(branchId, ctx, ready, send, () => {}), {
      initialProps: { branchId: BRANCH, ready },
    })

  beforeEach(async () => {
    send.mockReset()
    entriesStore.__reset()
    ctx = await seedBranch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('sends a landing straight to a ready reader', async () => {
    const { result } = mount(true)
    await act(() => result.current.jump('entry_10'))
    expect(send).toHaveBeenCalledExactlyOnceWith('entry_10')
  })

  // A document reloaded during the read would lose the call.
  it('holds a landing until the reader is ready, with the veil up', async () => {
    const { result, rerender } = mount(false)
    await act(() => result.current.jump('entry_10'))
    expect(send).not.toHaveBeenCalled()
    expect(result.current.veil.isWaiting()).toBe(true)

    rerender({ branchId: BRANCH, ready: true })
    expect(send).toHaveBeenCalledExactlyOnceWith('entry_10')
    expect(result.current.veil.isWaiting()).toBe(true)

    act(() => result.current.landed('entry_10'))
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('holds a landing made after a reload took the reader down', async () => {
    const { result, rerender } = mount(true)
    rerender({ branchId: BRANCH, ready: false })
    await act(() => result.current.jump('entry_10'))
    expect(send).not.toHaveBeenCalled()

    rerender({ branchId: BRANCH, ready: true })
    expect(send).toHaveBeenCalledExactlyOnceWith('entry_10')
  })

  it('holds a landing for a row already in the window too', async () => {
    const { result, rerender } = mount(false)
    await act(() => result.current.jump('entry_100'))
    expect(send).not.toHaveBeenCalled()

    rerender({ branchId: BRANCH, ready: true })
    expect(send).toHaveBeenCalledExactlyOnceWith('entry_100')
  })

  it('drops a held landing when a newer jump starts its read', async () => {
    const { result, rerender } = mount(false)
    await act(() => result.current.jump('entry_100'))

    let newer!: Promise<void>
    act(() => {
      newer = result.current.jump('entry_10')
    })
    rerender({ branchId: BRANCH, ready: true })
    await act(() => newer)
    expect(send.mock.calls).toEqual([['entry_10']])
  })

  it('keeps the wait when a reload loses an older landing of the same row', async () => {
    const { result, rerender } = mount(true)
    await act(() => result.current.jump('entry_100'))
    expect(send).toHaveBeenCalledExactlyOnceWith('entry_100')
    entriesStore.hydrate(
      BRANCH,
      Array.from({ length: 20 }, (_, i) => row(101 + i)),
    )

    let again!: Promise<void>
    act(() => {
      again = result.current.jump('entry_100')
    })
    rerender({ branchId: BRANCH, ready: false })
    expect(result.current.veil.isWaiting()).toBe(true)
    await act(() => again)
  })

  it('lifts the veil when a reload loses a landing already sent', async () => {
    const { result, rerender } = mount(true)
    await act(() => result.current.jump('entry_10'))
    expect(result.current.veil.isWaiting()).toBe(true)

    rerender({ branchId: BRANCH, ready: false })
    expect(result.current.veil.isWaiting()).toBe(false)
    rerender({ branchId: BRANCH, ready: true })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('warns when a reload loses a landing its wait covers', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { result, rerender } = mount(true)
    await act(() => result.current.jump('entry_10'))
    expect(warn).not.toHaveBeenCalled()

    rerender({ branchId: BRANCH, ready: false })
    expect(warn).toHaveBeenCalledExactlyOnceWith('reader.entry_jump_dropped', {
      branchId: BRANCH,
      entryId: 'entry_10',
      cause: 'document_reload',
    })
  })

  it('warns nothing when a reload follows a landing no wait covered', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { result, rerender } = mount(true)
    await act(() => result.current.jump('entry_100'))
    expect(send).toHaveBeenCalledExactlyOnceWith('entry_100')

    rerender({ branchId: BRANCH, ready: false })
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns nothing when a reload follows a landing that signalled', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { result, rerender } = mount(true)
    await act(() => result.current.jump('entry_10'))
    act(() => result.current.landed('entry_10'))

    rerender({ branchId: BRANCH, ready: false })
    expect(warn).not.toHaveBeenCalled()
  })

  it('lifts the veil when a second reload loses a landing it held', async () => {
    const { result, rerender } = mount(false)
    await act(() => result.current.jump('entry_10'))
    rerender({ branchId: BRANCH, ready: true })
    expect(send).toHaveBeenCalledExactlyOnceWith('entry_10')

    rerender({ branchId: BRANCH, ready: false })
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('drops a held landing whose veil lifted meanwhile', async () => {
    const { result, rerender } = mount(false)
    await act(() => result.current.jump('entry_10'))
    entriesStore.hydrate(
      BRANCH,
      Array.from({ length: 50 }, (_, i) => row(71 + i)),
    )
    expect(result.current.veil.isWaiting()).toBe(false)

    rerender({ branchId: BRANCH, ready: true })
    expect(send).not.toHaveBeenCalled()
  })

  it('drops a held landing on a branch change', async () => {
    const { result, rerender } = mount(false)
    await act(() => result.current.jump('entry_100'))

    rerender({ branchId: 'br_other', ready: false })
    rerender({ branchId: 'br_other', ready: true })
    expect(send).not.toHaveBeenCalled()
  })

  // As the route holds them: on native each route commit re-sends the whole window, and a shimmer
  // dropped a commit late, under a reader landed on the first row, shifts it.
  it('drops the shimmer in the commit that brings the branch top', async () => {
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const commits: { top: boolean; hasOlder: boolean }[] = []
    const { result } = renderHook(() => {
      const rows = entriesStore.useEntries((m) => m)
      const [hasOlder, setHasOlder] = useState(true)
      const markTopLoaded = useCallback(() => setHasOlder(false), [])
      const entryJump = useReaderEntryJump(BRANCH, ctx, true, send, markTopLoaded)
      useLayoutEffect(() => {
        commits.push({ top: rows.has('entry_1'), hasOlder })
      })
      return entryJump
    })
    // Outside act, so the store's update and the state's are scheduled as the app's are.
    env.IS_REACT_ACT_ENVIRONMENT = false
    try {
      await result.current.jump('entry_1')
      await vi.waitFor(() => expect(commits.at(-1)).toEqual({ top: true, hasOlder: false }))
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true
    }
    expect(commits.filter((commit) => commit.top)).toEqual([{ top: true, hasOlder: false }])
  })

  it('raises and lifts the veil without re-rendering its consumer', async () => {
    let renders = 0
    const { result, rerender } = renderHook(
      ({ ready }) => {
        renders += 1
        return useReaderEntryJump(BRANCH, ctx, ready, send, () => {})
      },
      { initialProps: { ready: false } },
    )
    await act(() => result.current.jump('entry_10'))
    rerender({ ready: true })
    const before = renders

    act(() => result.current.landed('entry_10'))
    expect(send).toHaveBeenCalledWith('entry_10')
    expect(renders).toBe(before)
  })
})
