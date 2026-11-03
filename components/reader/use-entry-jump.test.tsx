// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readEntriesBetween, readEntryPosition } from '@/lib/actions'
import { branches, stories, storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { entriesStore, resetAllStores } from '@/lib/stores'
import { toast } from '@/lib/toast'

import { useEntryJump, useJumpVeilUp } from './use-entry-jump'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

// Wrapped, not replaced: the reads run for real over the test db, and a test can hold one open.
vi.mock('@/lib/actions', async (importOriginal) => {
  const actual = await importOriginal<{
    readEntryPosition: typeof readEntryPosition
    readEntriesBetween: typeof readEntriesBetween
  }>()
  return {
    ...actual,
    readEntryPosition: vi.fn(actual.readEntryPosition),
    readEntriesBetween: vi.fn(actual.readEntriesBetween),
  }
})

const BRANCH = 'br_long'
const CHUNK = 50
const TOTAL = 41 * CHUNK

const idAt = (position: number) => `e${position}`

function row(position: number): StoryEntry {
  return {
    id: idAt(position),
    branchId: BRANCH,
    position,
    kind: 'user_action',
    content: `entry ${position}`,
    contentTokens: null,
    chapterId: null,
    metadata: null,
    createdAt: position,
  }
}

const span = (from: number, through: number): StoryEntry[] =>
  Array.from({ length: through - from + 1 }, (_, i) => row(from + i))

const loadedPositions = () =>
  [...entriesStore.getEntries().values()].map((r) => r.position).sort((a, b) => a - b)

function expectContiguous(from: number, through: number) {
  expect(loadedPositions()).toEqual(span(from, through).map((r) => r.position))
}

function deferred() {
  let open!: () => void
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return { gate, open }
}

// vi.waitFor advances fake timers on each check; setImmediate isn't faked.
async function untilReadCalls(times: number) {
  for (let turn = 0; vi.mocked(readEntriesBetween).mock.calls.length < times; turn++) {
    if (turn === 1_000) throw new Error(`readEntriesBetween never reached ${times} calls`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function holdNextBetween(failWith?: Error) {
  const { gate, open } = deferred()
  const actual = vi.mocked(readEntriesBetween).getMockImplementation()!
  vi.mocked(readEntriesBetween).mockImplementationOnce(async (...args) => {
    await gate
    if (failWith) throw failWith
    return actual(...args)
  })
  return open
}

function holdNextPosition(failWith?: Error) {
  const { gate, open } = deferred()
  const actual = vi.mocked(readEntryPosition).getMockImplementation()!
  vi.mocked(readEntryPosition).mockImplementationOnce(async (...args) => {
    await gate
    if (failWith) throw failWith
    return actual(...args)
  })
  return open
}

describe('useEntryJump', () => {
  let ctx: DbCtx
  const land = vi.fn<(entryId: string) => void>()
  const topLoaded = vi.fn<() => void>()

  const jump = () =>
    renderHook(() => useEntryJump(BRANCH, ctx, land, topLoaded)).result.current.jump

  beforeEach(async () => {
    const { db, runInTransaction } = await createTestDb()
    ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'S', createdAt: 0, updatedAt: 0 })
    await db.insert(branches).values({ id: BRANCH, storyId: 's1', name: 'Main', createdAt: 0 })
    await db.insert(storyEntries).values(span(1, TOTAL))

    resetAllStores()
    entriesStore.hydrate(BRANCH, span(TOTAL - CHUNK + 1, TOTAL))
    land.mockReset()
    topLoaded.mockReset()
    vi.mocked(readEntryPosition).mockClear()
    vi.mocked(readEntriesBetween).mockClear()
    vi.mocked(toast.warning).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('lands on a row in the window without reading', async () => {
    await jump()(idAt(TOTAL - 10))

    expect(land).toHaveBeenCalledExactlyOnceWith(idAt(TOTAL - 10))
    expect(readEntryPosition).not.toHaveBeenCalled()
    expect(readEntriesBetween).not.toHaveBeenCalled()
  })

  it("does not land on another branch's copy of the id", async () => {
    entriesStore.hydrate('br_other', [{ ...row(TOTAL - 10), branchId: 'br_other' }])

    await jump()(idAt(TOTAL - 10))

    expect(readEntryPosition).toHaveBeenCalledTimes(1)
    expect(land).not.toHaveBeenCalled()
  })

  it('makes one read and one store write for a target 40 chunks back', async () => {
    const insertMany = vi.spyOn(entriesStore, 'insertMany')
    const patch = vi.spyOn(entriesStore, 'patch')

    await jump()(idAt(1))

    expect(readEntriesBetween).toHaveBeenCalledTimes(1)
    expect(insertMany).toHaveBeenCalledTimes(1)
    expect(patch).not.toHaveBeenCalled()
    expectContiguous(1, TOTAL)
    expect(land).toHaveBeenCalledExactlyOnceWith(idAt(1))
  })

  // A chapter's break hangs off the previous chapter's end row, so the landing needs that row too.
  it('reads the row above a target outside the window', async () => {
    await jump()(idAt(1000))

    expectContiguous(999, TOTAL)
    expect(land).toHaveBeenCalledExactlyOnceWith(idAt(1000))
  })

  // A shimmer dropped after the rows' commit shifts a reader landed at the top (scrollTop can't
  // go below 0). Pins the tick, not the order; useReaderEntryJump's commit-count test guards it.
  it('tells the host the branch top is loaded in the tick of the rows write', async () => {
    let writeTickOpen = false
    const unsubscribe = entriesStore.subscribe(() => {
      writeTickOpen = true
      queueMicrotask(() => {
        writeTickOpen = false
      })
    })
    let sameTick: boolean | null = null
    topLoaded.mockImplementation(() => {
      if (entriesStore.getById(idAt(1)) !== undefined) {
        sameTick = writeTickOpen
        return
      }
      queueMicrotask(() => {
        sameTick = entriesStore.getById(idAt(1)) !== undefined
      })
    })

    await jump()(idAt(1))
    unsubscribe()

    expect(topLoaded).toHaveBeenCalledTimes(1)
    expect(sameTick).toBe(true)
    expect(land).toHaveBeenCalledExactlyOnceWith(idAt(1))
  })

  it('says nothing of the branch top for a read with a row above its target', async () => {
    await jump()(idAt(2))

    expectContiguous(1, TOTAL)
    expect(topLoaded).not.toHaveBeenCalled()
  })

  it('reads nothing and says nothing of the branch top for a row in the window', async () => {
    entriesStore.hydrate(BRANCH, span(1, TOTAL))

    await jump()(idAt(1))

    expect(readEntriesBetween).not.toHaveBeenCalled()
    expect(topLoaded).not.toHaveBeenCalled()
  })

  it('lands only after the rows are in the store', async () => {
    let inStoreAtLanding = false
    land.mockImplementation((id) => {
      inStoreAtLanding = entriesStore.getById(id) !== undefined
    })

    await jump()(idAt(1))

    expect(inStoreAtLanding).toBe(true)
  })

  it('toasts, writes nothing and stays put for an id not on the branch', async () => {
    const insertMany = vi.spyOn(entriesStore, 'insertMany')

    await jump()('e_gone')

    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(t('reader:jumpEntryGone'))
    expect(insertMany).not.toHaveBeenCalled()
    expect(land).not.toHaveBeenCalled()
    expect(readEntriesBetween).not.toHaveBeenCalled()
  })

  it('reads again when a reload shrank the window during the read', async () => {
    entriesStore.hydrate(BRANCH, span(TOTAL - 2 * CHUNK + 1, TOTAL))
    const open = holdNextBetween()

    const pending = jump()(idAt(1))
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))
    entriesStore.hydrate(BRANCH, span(TOTAL - CHUNK + 1, TOTAL))
    open()
    await pending

    expect(readEntriesBetween).toHaveBeenCalledTimes(2)
    expect(vi.mocked(readEntriesBetween).mock.calls[1]?.[2]).toBe(TOTAL - CHUNK + 1)
    expectContiguous(1, TOTAL)
    expect(land).toHaveBeenCalledExactlyOnceWith(idAt(1))
  })

  it('reads again when a boundary load grew the window during the read', async () => {
    const open = holdNextBetween()

    const pending = jump()(idAt(1))
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))
    entriesStore.insertMany(BRANCH, span(TOTAL - 2 * CHUNK + 1, TOTAL - CHUNK))
    open()
    await pending

    expect(readEntriesBetween).toHaveBeenCalledTimes(2)
    expect(vi.mocked(readEntriesBetween).mock.calls[1]?.[2]).toBe(TOTAL - 2 * CHUNK + 1)
    expectContiguous(1, TOTAL)
  })

  it('lands when a boundary load brought the target into the window during the read', async () => {
    const open = holdNextBetween()

    const pending = jump()(idAt(TOTAL - 60))
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))
    entriesStore.insertMany(BRANCH, span(TOTAL - 2 * CHUNK + 1, TOTAL - CHUNK))
    open()
    await pending

    expect(land).toHaveBeenCalledExactlyOnceWith(idAt(TOTAL - 60))
    expectContiguous(TOTAL - 2 * CHUNK + 1, TOTAL)
  })

  it('drops the read silently when the branch changes under it', async () => {
    const open = holdNextBetween()
    const insertMany = vi.spyOn(entriesStore, 'insertMany')

    const pending = jump()(idAt(1))
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))
    entriesStore.hydrate('br_other', [])
    open()
    await pending

    expect(insertMany).not.toHaveBeenCalled()
    expect(land).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  // A missing id is the one case the emptied window can't stop: only the branch check holds the
  // toast back, for an id that may well exist on the branch being left.
  it('swallows the missing-entry toast when the branch changes under the position read', async () => {
    const pending = jump()('e_gone')
    entriesStore.hydrate('br_other', [])
    await pending

    expect(toast.warning).not.toHaveBeenCalled()
    expect(readEntriesBetween).not.toHaveBeenCalled()
  })

  it('stops without landing on an empty window, which has no row to read up to', async () => {
    entriesStore.hydrate(BRANCH, [])

    await jump()(idAt(1))

    expect(readEntriesBetween).not.toHaveBeenCalled()
    expect(land).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('lets a newer call replace one in flight', async () => {
    const open = holdNextBetween()
    const go = jump()

    const first = go(idAt(1))
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))
    await act(() => go(idAt(TOTAL - 10)))
    open()
    await first

    expect(land).toHaveBeenCalledExactlyOnceWith(idAt(TOTAL - 10))
    expectContiguous(TOTAL - CHUNK + 1, TOTAL)
  })

  it('logs, toasts and resolves when a read fails', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.mocked(readEntryPosition).mockRejectedValueOnce(new Error('disk gone'))

    await expect(jump()(idAt(1))).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledExactlyOnceWith('reader.entry_jump_failed', {
      branchId: BRANCH,
      entryId: idAt(1),
      error: 'disk gone',
    })
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(t('reader:jumpFailed'))
    expect(land).not.toHaveBeenCalled()
  })

  it('logs and toasts when the rows read fails after the position read', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.mocked(readEntriesBetween).mockRejectedValueOnce(new Error('disk gone'))

    await expect(jump()(idAt(1))).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(land).not.toHaveBeenCalled()
  })

  it('keeps the log but skips the toast when a superseded jump fails', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const { gate, open } = deferred()
    vi.mocked(readEntriesBetween).mockImplementationOnce(async () => {
      await gate
      throw new Error('disk gone')
    })
    const go = jump()

    const first = go(idAt(1))
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))
    await act(() => go(idAt(TOTAL - 10)))
    open()
    await first

    expect(error).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(land).toHaveBeenCalledExactlyOnceWith(idAt(TOTAL - 10))
  })

  it('logs, toasts and resolves when land throws on a row already in the window', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    land.mockImplementation(() => {
      throw new Error('surface gone')
    })

    await expect(jump()(idAt(TOTAL - 10))).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(t('reader:jumpFailed'))
  })

  it('toasts and stays put when the target is gone after the rows read', async () => {
    vi.mocked(readEntriesBetween).mockResolvedValueOnce([])

    await jump()(idAt(1))

    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(t('reader:jumpEntryGone'))
    expect(land).not.toHaveBeenCalled()
  })
})

describe('useEntryJump: jumping', () => {
  const BRANCH = 'br_jumping'
  const BROKEN_CTX = { db: {}, runInTransaction: async () => {} } as unknown as DbCtx
  const land = vi.fn<(entryId: string) => void>()

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
    await db.insert(stories).values({ id: 's_jumping', title: 'T', createdAt: 1, updatedAt: 1 })
    await db
      .insert(branches)
      .values({ id: BRANCH, storyId: 's_jumping', name: 'main', createdAt: 1 })
    const rows = Array.from({ length: 120 }, (_, i) => row(i + 1))
    await db.insert(storyEntries).values(rows)
    entriesStore.hydrate(BRANCH, rows.slice(-50))
    return { db, runInTransaction }
  }

  beforeEach(() => {
    land.mockReset()
    entriesStore.__reset()
    vi.mocked(readEntryPosition).mockClear()
    vi.mocked(readEntriesBetween).mockClear()
    vi.mocked(toast.warning).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    cleanup()
  })

  it('stays up past the read until the landing signal names the target', async () => {
    const ctx = await seedBranch()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    expect(result.current.veil.isWaiting()).toBe(false)

    await act(() => result.current.jump('entry_10'))
    expect(land).toHaveBeenCalledWith('entry_10')
    expect(result.current.veil.isWaiting()).toBe(true)

    act(() => result.current.landed('entry_10'))
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  // On native a route render re-sends the whole window to the document.
  it('raises and lifts the veil without re-rendering its consumer', async () => {
    const ctx = await seedBranch()
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useEntryJump(BRANCH, ctx, land, () => {})
    })
    const before = renders

    await act(() => result.current.jump('entry_10'))
    act(() => result.current.landed('entry_10'))

    expect(land).toHaveBeenCalledWith('entry_10')
    expect(renders).toBe(before)
  })

  it('re-renders a veil subscriber as the veil shows and lifts', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    const { result: up } = renderHook(() => useJumpVeilUp(result.current.veil))
    expect(up.current).toBe(false)

    await act(() => result.current.jump('entry_10'))
    expect(up.current).toBe(false)
    act(() => vi.advanceTimersByTime(200))
    expect(up.current).toBe(true)

    act(() => result.current.landed('entry_10'))
    expect(up.current).toBe(false)
  })

  // A reload's hydrate can trim the window before the document mounts the row.
  it('comes down when its target leaves the store after the landing call', async () => {
    const ctx = await seedBranch()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    expect(result.current.veil.isWaiting()).toBe(true)

    entriesStore.hydrate(
      BRANCH,
      Array.from({ length: 50 }, (_, i) => row(71 + i)),
    )
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('stays up while store changes leave its target in place', async () => {
    const ctx = await seedBranch()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))

    entriesStore.insertMany(BRANCH, [row(121)])
    expect(result.current.veil.isWaiting()).toBe(true)
  })

  // Literal, not the constant: the bound must stay well above the 10.7 s a 60-chapter jump took.
  it('comes down 30 s after the landing call when no signal arrives', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))

    vi.advanceTimersByTime(29_999)
    expect(result.current.veil.isWaiting()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('warns when the bound ends the wait', async () => {
    const ctx = await seedBranch()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))

    vi.advanceTimersByTime(29_999)
    expect(warn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(warn).toHaveBeenCalledExactlyOnceWith('reader.entry_jump_dropped', {
      branchId: BRANCH,
      entryId: 'entry_10',
      cause: 'bound',
    })
  })

  // `rowsReads`: the rows reads made before the held read, which is where the jump stalls.
  const stalls = [
    { read: 'position', hold: holdNextPosition, rowsReads: 0 },
    { read: 'rows', hold: holdNextBetween, rowsReads: 1 },
  ]

  it.each(stalls)(
    'comes down and warns 30 s after the press when the $read read stalls',
    async ({ hold, rowsReads }) => {
      const ctx = await seedBranch()
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      hold()
      const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
      act(() => {
        void result.current.jump('entry_10')
      })
      await untilReadCalls(rowsReads)

      vi.advanceTimersByTime(29_999)
      expect(result.current.veil.isWaiting()).toBe(true)
      vi.advanceTimersByTime(1)
      expect(result.current.veil.isWaiting()).toBe(false)
      expect(warn).toHaveBeenCalledExactlyOnceWith('reader.entry_jump_dropped', {
        branchId: BRANCH,
        entryId: 'entry_10',
        cause: 'bound',
      })
    },
  )

  it.each(stalls)(
    'neither writes, lands, toasts nor bounds again when the $read read ends after the bound',
    async ({ hold, rowsReads }) => {
      const ctx = await seedBranch()
      vi.spyOn(logger, 'warn').mockImplementation(() => {})
      const insertMany = vi.spyOn(entriesStore, 'insertMany')
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const open = hold()
      const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
      let pending!: Promise<void>
      act(() => {
        pending = result.current.jump('entry_10')
      })
      await untilReadCalls(rowsReads)
      vi.advanceTimersByTime(30_000)

      await act(async () => {
        open()
        await pending
      })
      expect(land).not.toHaveBeenCalled()
      expect(insertMany).not.toHaveBeenCalled()
      expect(toast.warning).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it.each(stalls)(
    'logs without a toast when the $read read fails after the bound',
    async ({ hold, rowsReads }) => {
      const ctx = await seedBranch()
      vi.spyOn(logger, 'warn').mockImplementation(() => {})
      const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const open = hold(new Error('disk gone'))
      const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
      let pending!: Promise<void>
      act(() => {
        pending = result.current.jump('entry_10')
      })
      await untilReadCalls(rowsReads)
      vi.advanceTimersByTime(30_000)

      await act(async () => {
        open()
        await pending
      })
      expect(error).toHaveBeenCalledExactlyOnceWith('reader.entry_jump_failed', {
        branchId: BRANCH,
        entryId: 'entry_10',
        error: 'disk gone',
      })
      expect(toast.error).not.toHaveBeenCalled()
      expect(land).not.toHaveBeenCalled()
    },
  )

  it('warns for the newer target only when a replaced jump would have run out', async () => {
    const ctx = await seedBranch()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    vi.advanceTimersByTime(15_000)
    await act(() => result.current.jump('entry_5'))

    vi.advanceTimersByTime(15_000)
    expect(warn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(15_000)
    expect(warn).toHaveBeenCalledExactlyOnceWith('reader.entry_jump_dropped', {
      branchId: BRANCH,
      entryId: 'entry_5',
      cause: 'bound',
    })
  })

  it('warns when its target leaves the window after the landing call', async () => {
    const ctx = await seedBranch()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    entriesStore.insertMany(BRANCH, [row(121)])
    expect(warn).not.toHaveBeenCalled()

    entriesStore.hydrate(
      BRANCH,
      Array.from({ length: 50 }, (_, i) => row(71 + i)),
    )
    expect(warn).toHaveBeenCalledExactlyOnceWith('reader.entry_jump_dropped', {
      branchId: BRANCH,
      entryId: 'entry_10',
      cause: 'left_window',
    })
  })

  // The reader is being left: not a landing the reader dropped.
  it('comes down without a warn when another branch loads under the wait', async () => {
    const ctx = await seedBranch()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))

    entriesStore.hydrate('br_other', [])
    expect(result.current.veil.isWaiting()).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns nothing when its row leaves the window after it landed', async () => {
    const ctx = await seedBranch()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    act(() => result.current.landed('entry_10'))

    entriesStore.hydrate(
      BRANCH,
      Array.from({ length: 50 }, (_, i) => row(71 + i)),
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it("keeps a replaced target's bound off the newer jump's veil", async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    vi.advanceTimersByTime(15_000)

    const open = holdNextBetween()
    let newer!: Promise<void>
    act(() => {
      newer = result.current.jump('entry_5')
    })
    await untilReadCalls(2)
    vi.advanceTimersByTime(15_000)
    expect(result.current.veil.isWaiting()).toBe(true)

    await act(async () => {
      open()
      await newer
    })
    vi.advanceTimersByTime(29_999)
    expect(result.current.veil.isWaiting()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('leaves no bound running once it unmounts after the landing call', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result, unmount } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    // The veil's show and the landing's bound.
    expect(vi.getTimerCount()).toBe(2)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts no bound for a read that finishes after it unmounts', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const open = holdNextBetween()
    const { result, unmount } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    let pending!: Promise<void>
    act(() => {
      pending = result.current.jump('entry_10')
    })
    await untilReadCalls(1)

    unmount()
    open()
    await pending
    expect(land).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops a read that a quick switch away and back left behind', async () => {
    const ctx = await seedBranch()
    const open = holdNextBetween()
    const { result, rerender } = renderHook(
      ({ branchId }) => useEntryJump(branchId, ctx, land, () => {}),
      {
        initialProps: { branchId: BRANCH },
      },
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.jump('entry_10')
    })
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))

    rerender({ branchId: 'br_other' })
    rerender({ branchId: BRANCH })
    await act(async () => {
      open()
      await pending
    })
    expect(land).not.toHaveBeenCalled()
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  // Literals, not the constant: the veil shows only once a jump has waited about 200 ms.
  it('never shows the veil for a jump that lands within 200 ms', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))

    vi.advanceTimersByTime(199)
    expect(result.current.veil.getSnapshot()).toBe(false)
    act(() => result.current.landed('entry_10'))
    vi.advanceTimersByTime(1_000)
    expect(result.current.veil.getSnapshot()).toBe(false)
  })

  it('shows the veil at 200 ms for a jump still reading, until it lands', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const open = holdNextBetween()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    let pending!: Promise<void>
    act(() => {
      pending = result.current.jump('entry_10')
    })
    await untilReadCalls(1)

    vi.advanceTimersByTime(199)
    expect(result.current.veil.getSnapshot()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(result.current.veil.getSnapshot()).toBe(true)

    await act(async () => {
      open()
      await pending
    })
    expect(result.current.veil.getSnapshot()).toBe(true)
    act(() => result.current.landed('entry_10'))
    expect(result.current.veil.getSnapshot()).toBe(false)
  })

  it('counts the veil from the first press when a newer jump joins the wait', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const openFirst = holdNextBetween()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    let first!: Promise<void>
    act(() => {
      first = result.current.jump('entry_10')
    })
    await untilReadCalls(1)
    vi.advanceTimersByTime(150)

    const openNewer = holdNextBetween()
    let newer!: Promise<void>
    act(() => {
      newer = result.current.jump('entry_5')
    })
    await untilReadCalls(2)
    vi.advanceTimersByTime(49)
    expect(result.current.veil.getSnapshot()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(result.current.veil.getSnapshot()).toBe(true)

    await act(async () => {
      openFirst()
      openNewer()
      await Promise.all([first, newer])
    })
  })

  it('never shows the veil for a jump dropped before 200 ms', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    vi.advanceTimersByTime(100)

    entriesStore.hydrate(
      BRANCH,
      Array.from({ length: 50 }, (_, i) => row(71 + i)),
    )
    vi.advanceTimersByTime(1_000)
    expect(result.current.veil.getSnapshot()).toBe(false)
  })

  it('counts the veil from the first press when an in-window jump joins the wait', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    vi.advanceTimersByTime(100)

    await act(() => result.current.jump('entry_100'))
    vi.advanceTimersByTime(99)
    expect(result.current.veil.getSnapshot()).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.veil.getSnapshot()).toBe(true)
    act(() => result.current.landed('entry_100'))
    expect(result.current.veil.getSnapshot()).toBe(false)
  })

  it('never shows the veil after a branch change before 200 ms', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result, rerender } = renderHook(
      ({ branchId }) => useEntryJump(branchId, ctx, land, () => {}),
      { initialProps: { branchId: BRANCH } },
    )
    await act(() => result.current.jump('entry_10'))
    vi.advanceTimersByTime(100)

    rerender({ branchId: 'br_other' })
    vi.advanceTimersByTime(1_000)
    expect(result.current.veil.getSnapshot()).toBe(false)
  })

  it('never goes up for a row already in the window', async () => {
    const ctx = await seedBranch()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_100'))
    expect(land).toHaveBeenCalledWith('entry_100')
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('comes down on the toast for an id not on the branch', async () => {
    const ctx = await seedBranch()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_missing'))
    expect(land).not.toHaveBeenCalled()
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('comes down on the toast for a target gone after the rows read', async () => {
    const ctx = await seedBranch()
    vi.mocked(readEntriesBetween).mockResolvedValueOnce([])
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    expect(land).not.toHaveBeenCalled()
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('comes down when the read fails', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    await seedBranch()
    const { result } = renderHook(() => useEntryJump(BRANCH, BROKEN_CTX, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    expect(land).not.toHaveBeenCalled()
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('comes down when the branch leaves under the read', async () => {
    const ctx = await seedBranch()
    entriesStore.hydrate('br_other', [])
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    expect(land).not.toHaveBeenCalled()
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('comes down on an empty window, which has no row to read up to', async () => {
    const ctx = await seedBranch()
    entriesStore.hydrate(BRANCH, [])
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    expect(land).not.toHaveBeenCalled()
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('comes down when the branch changes after the landing call', async () => {
    const ctx = await seedBranch()
    const { result, rerender } = renderHook(
      ({ branchId }) => useEntryJump(branchId, ctx, land, () => {}),
      {
        initialProps: { branchId: BRANCH },
      },
    )
    await act(() => result.current.jump('entry_10'))
    expect(result.current.veil.isWaiting()).toBe(true)

    rerender({ branchId: 'br_other' })
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it("ignores a replaced target's signal and waits for the newer one", async () => {
    const ctx = await seedBranch()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    await act(() => result.current.jump('entry_5'))

    act(() => result.current.landed('entry_10'))
    expect(result.current.veil.isWaiting()).toBe(true)

    act(() => result.current.landed('entry_5'))
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('stays up when a replaced read finishes under a newer one', async () => {
    const ctx = await seedBranch()
    const error = vi.spyOn(logger, 'error')
    const open = holdNextBetween()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))

    let first!: Promise<void>
    act(() => {
      first = result.current.jump('entry_10')
    })
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))
    const second = holdNextBetween()
    let newer!: Promise<void>
    act(() => {
      newer = result.current.jump('entry_5')
    })
    await act(async () => {
      open()
      await first
    })
    expect(result.current.veil.isWaiting()).toBe(true)

    await act(async () => {
      second()
      await newer
    })
    expect(error).not.toHaveBeenCalled()
    expect(land).toHaveBeenCalledExactlyOnceWith('entry_5')
    expect(result.current.veil.isWaiting()).toBe(true)
  })

  it('stays up when a replaced position read finishes under a newer one', async () => {
    const ctx = await seedBranch()
    const { gate, open } = deferred()
    const actual = vi.mocked(readEntryPosition).getMockImplementation()!
    vi.mocked(readEntryPosition).mockImplementationOnce(async (...args) => {
      await gate
      return actual(...args)
    })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))

    let first!: Promise<void>
    act(() => {
      first = result.current.jump('entry_10')
    })
    await act(() => result.current.jump('entry_5'))
    await act(async () => {
      open()
      await first
    })

    expect(land).toHaveBeenCalledExactlyOnceWith('entry_5')
    expect(result.current.veil.isWaiting()).toBe(true)
  })

  it('stays up when a replaced read fails under a newer one', async () => {
    const ctx = await seedBranch()
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    const { gate, open } = deferred()
    vi.mocked(readEntriesBetween).mockImplementationOnce(async () => {
      await gate
      throw new Error('disk gone')
    })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))

    let first!: Promise<void>
    act(() => {
      first = result.current.jump('entry_10')
    })
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))
    await act(() => result.current.jump('entry_5'))
    await act(async () => {
      open()
      await first
    })

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(land).toHaveBeenCalledExactlyOnceWith('entry_5')
    expect(result.current.veil.isWaiting()).toBe(true)
  })

  // On native the host's store runs ahead of the document, which may not have the row yet.
  it('keeps the wait for an in-window jump made while it runs, until that row lands', async () => {
    const ctx = await seedBranch()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    await act(() => result.current.jump('entry_100'))
    expect(land.mock.calls).toEqual([['entry_10'], ['entry_100']])
    expect(result.current.veil.isWaiting()).toBe(true)

    act(() => result.current.landed('entry_10'))
    expect(result.current.veil.isWaiting()).toBe(true)
    act(() => result.current.landed('entry_100'))
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  // The web surface reports the landing it replaces from inside the newer landing call.
  it('keeps a joined wait when the landing call signals the replaced target', async () => {
    const ctx = await seedBranch()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    land.mockImplementation((id) => {
      if (id === 'entry_100') result.current.landed('entry_10')
    })

    await act(() => result.current.jump('entry_100'))
    expect(result.current.veil.isWaiting()).toBe(true)
  })

  it('keeps the wait when a replaced read finishes under an in-window jump', async () => {
    const ctx = await seedBranch()
    const open = holdNextBetween()
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    let first!: Promise<void>
    act(() => {
      first = result.current.jump('entry_10')
    })
    await vi.waitFor(() => expect(readEntriesBetween).toHaveBeenCalledTimes(1))

    await act(() => result.current.jump('entry_100'))
    await act(async () => {
      open()
      await first
    })
    expect(land).toHaveBeenCalledExactlyOnceWith('entry_100')
    expect(result.current.veil.isWaiting()).toBe(true)
    act(() => result.current.landed('entry_100'))
    expect(result.current.veil.isWaiting()).toBe(false)
  })

  it('bounds a joined wait from the in-window landing call', async () => {
    const ctx = await seedBranch()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    await act(() => result.current.jump('entry_10'))
    vi.advanceTimersByTime(15_000)
    await act(() => result.current.jump('entry_100'))

    act(() => vi.advanceTimersByTime(29_999))
    expect(result.current.veil.isWaiting()).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.veil.isWaiting()).toBe(false)
    expect(warn).toHaveBeenCalledExactlyOnceWith('reader.entry_jump_dropped', {
      branchId: BRANCH,
      entryId: 'entry_100',
      cause: 'bound',
    })
  })

  it('reads nothing and arms nothing for an in-window jump with no wait running', async () => {
    const ctx = await seedBranch()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { result } = renderHook(() => useEntryJump(BRANCH, ctx, land, () => {}))
    const heard = vi.fn()
    const unsubscribe = result.current.veil.subscribe(heard)

    await act(() => result.current.jump('entry_100'))
    unsubscribe()
    expect(land).toHaveBeenCalledExactlyOnceWith('entry_100')
    expect(readEntryPosition).not.toHaveBeenCalled()
    expect(readEntriesBetween).not.toHaveBeenCalled()
    expect(heard).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
