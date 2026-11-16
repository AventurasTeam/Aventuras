// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { useLayoutEffect, useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { branches, stories, storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entriesStore } from '@/lib/stores'

import { useReaderSlice } from './use-reader-slice'

const BRANCH = 'br_slice'

const row = (position: number, branchId = BRANCH): StoryEntry => ({
  id: `entry_${position}`,
  branchId,
  position,
  kind: 'user_action',
  content: `Entry ${position}`,
  contentTokens: null,
  chapterId: null,
  metadata: null,
  createdAt: position,
})
const span = (from: number, to: number, branchId = BRANCH) =>
  Array.from({ length: to - from + 1 }, (_, i) => row(from + i, branchId))

// 120 rows in the db, the newest 50 in the store.
async function seed(): Promise<DbCtx> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's_slice', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 's_slice', name: 'main', createdAt: 1 })
  await db.insert(storyEntries).values(span(1, 120))
  entriesStore.hydrate(BRANCH, span(71, 120))
  return { db, runInTransaction }
}

type Commit = { first?: number; last?: number; hasOlder: boolean; hasNewer: boolean; key: number }

/** The hook as the route holds it, recording every commit's slice. */
function mount(ctx: DbCtx, initialBranch = BRANCH) {
  const commits: Commit[] = []
  const hook = renderHook(
    ({ branchId }) => {
      const rows = entriesStore.useEntries((m) => m)
      const entries = useMemo(
        () =>
          [...rows.values()]
            .filter((entry) => entry.branchId === branchId)
            .sort((a, b) => a.position - b.position),
        [rows, branchId],
      )
      const slice = useReaderSlice(branchId, entries, ctx.db)
      useLayoutEffect(() => {
        commits.push({
          first: slice.rows[0]?.position,
          last: slice.rows.at(-1)?.position,
          hasOlder: slice.hasOlder,
          hasNewer: slice.hasNewer,
          key: slice.sliceKey,
        })
      })
      return slice
    },
    { initialProps: { branchId: initialBranch } },
  )
  return { ...hook, commits }
}

const idOf = (position: number) => `entry_${position}`

// The window grows above the open slice as a load or a jump's read grows it.
const growWindowAbove = () => act(() => entriesStore.insertMany(BRANCH, span(1, 70)))

describe('useReaderSlice', () => {
  let ctx: DbCtx

  beforeEach(async () => {
    entriesStore.__reset()
    ctx = await seed()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('opens on the whole window at the tail, older possible after a full page', () => {
    const { result } = mount(ctx)
    expect(result.current.rows.map((r) => r.position)).toEqual(span(71, 120).map((r) => r.position))
    expect(result.current).toMatchObject({ hasOlder: true, hasNewer: false })
  })

  it('reads a page above the window and extends into it in the insert’s commit', async () => {
    const { result, commits } = mount(ctx)
    const { sliceKey } = result.current
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    env.IS_REACT_ACT_ENVIRONMENT = false
    try {
      await result.current.requestNearTop({ sliceKey, keepId: idOf(90) })
      await vi.waitFor(() => expect(commits.at(-1)?.first).toBe(46))
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true
    }
    // The page read 21..70; the slice took 25 of them and trimmed its bottom to 50.
    expect(entriesStore.getById(idOf(21))).toBeDefined()
    expect(commits.at(-1)).toMatchObject({ first: 46, last: 95, hasNewer: true })
    // No commit showed the window grown under a slice that hadn't moved yet.
    expect(commits.filter((commit) => commit.first === 71 && commit.key > sliceKey)).toEqual([])
  })

  it('records a page that proves the branch top with the extension', async () => {
    entriesStore.hydrate(BRANCH, span(21, 120))
    const { result } = mount(ctx)
    await act(() =>
      result.current.requestNearTop({ sliceKey: result.current.sliceKey, keepId: idOf(100) }),
    )
    await act(async () => {
      await result.current.requestNearTop({ sliceKey: result.current.sliceKey, keepId: idOf(80) })
    })
    await act(async () => {
      await result.current.requestNearTop({ sliceKey: result.current.sliceKey, keepId: idOf(60) })
    })
    expect(result.current.rows[0].position).toBe(1)
    expect(result.current.hasOlder).toBe(false)
  })

  it('ignores a request measured on another slice', async () => {
    const { result } = mount(ctx)
    const stale = result.current.sliceKey - 1
    await act(() => result.current.requestNearTop({ sliceKey: stale, keepId: idOf(90) }))
    expect(entriesStore.getById(idOf(70))).toBeUndefined()
    expect(result.current.rows[0].position).toBe(71)
  })

  it('extends down and trims at the document’s request', async () => {
    const { result } = mount(ctx)
    growWindowAbove()
    act(() => {
      result.current.placeLanding(idOf(10))
    })
    expect(result.current.rows[0].position).toBe(9)
    expect(result.current.hasNewer).toBe(true)
    await act(() =>
      result.current.requestNearBottom({ sliceKey: result.current.sliceKey, keepId: idOf(30) }),
    )
    expect([result.current.rows[0].position, result.current.rows.at(-1)?.position]).toEqual([
      30, 83,
    ])
    await act(() =>
      result.current.requestTrim({
        end: 'bottom',
        sliceKey: result.current.sliceKey,
        keepId: idOf(75),
      }),
    )
    expect([result.current.rows[0].position, result.current.rows.at(-1)?.position]).toEqual([
      30, 79,
    ])
  })

  it('swaps a slice short of the tail to the tail’s last rows, and names its key', () => {
    const { result } = mount(ctx)
    growWindowAbove()
    act(() => {
      result.current.placeLanding(idOf(10))
    })
    expect(result.current.hasNewer).toBe(true)
    let key = 0
    act(() => {
      key = result.current.toTail()
    })
    expect(result.current).toMatchObject({ hasNewer: false, sliceKey: key })
    expect(result.current.rows[0].position).toBe(71)
  })

  it('keeps the key for Jump to bottom at the tail, where it scrolls', () => {
    const { result } = mount(ctx)
    const { sliceKey } = result.current
    let key = 0
    act(() => {
      key = result.current.toTail()
    })
    expect(key).toBe(sliceKey)
  })

  it('lands at once in the slice, and moves the slice for a window row outside it', () => {
    const { result } = mount(ctx)
    growWindowAbove()
    expect(result.current.classifyJump(idOf(100))).toBe('slice')
    expect(result.current.classifyJump(idOf(10))).toBe('window')
    const before = result.current.sliceKey
    let key = 0
    act(() => {
      key = result.current.placeLanding(idOf(10))
    })
    expect(key).toBeGreaterThan(before)
    expect(result.current).toMatchObject({ sliceKey: key })
    expect(result.current.rows[0].position).toBe(9)
  })

  it('names a new key when a read proves the top under a target already in the slice', () => {
    entriesStore.hydrate(BRANCH, span(1, 50))
    const { result } = mount(ctx)
    expect(result.current.classifyJump(idOf(1))).toBe('read')
    const before = result.current.sliceKey
    let key = 0
    act(() => {
      result.current.topLoaded()
      key = result.current.placeLanding(idOf(1))
    })
    expect(key).toBeGreaterThan(before)
    expect(result.current).toMatchObject({ hasOlder: false, sliceKey: key })
  })

  it('goes to the tail with the reloaded page’s top on a reload', () => {
    const { result } = mount(ctx)
    growWindowAbove()
    act(() => {
      result.current.placeLanding(idOf(10))
    })
    expect(result.current.hasNewer).toBe(true)
    act(() => {
      entriesStore.hydrate(BRANCH, span(101, 120))
      result.current.reloaded(false)
    })
    expect(result.current).toMatchObject({ hasOlder: false, hasNewer: false })
    expect(result.current.rows[0].position).toBe(101)
  })

  it('goes to the tail when the document reloads', () => {
    const { result } = mount(ctx)
    growWindowAbove()
    act(() => {
      result.current.placeLanding(idOf(10))
    })
    expect(result.current.hasNewer).toBe(true)
    act(() => result.current.resetToTail())
    expect(result.current.hasNewer).toBe(false)
    expect(result.current.rows[0].position).toBe(71)
  })

  it('falls to the tail when the window loses every row of the slice', () => {
    const { result } = mount(ctx)
    growWindowAbove()
    act(() => {
      result.current.placeLanding(idOf(10))
    })
    expect(result.current.rows[0].position).toBe(9)
    // A rollback from the slice's first row takes every row from it down.
    act(() => entriesStore.hydrate(BRANCH, span(1, 8)))
    expect(result.current.rows.map((r) => r.position)).toEqual(span(1, 8).map((r) => r.position))
    expect(result.current.hasNewer).toBe(false)
  })

  it('reopens at the tail of another branch', () => {
    const { result, rerender } = mount(ctx)
    const before = result.current.sliceKey
    act(() => {
      entriesStore.hydrate('br_next', span(1, 30, 'br_next'))
    })
    rerender({ branchId: 'br_next' })
    expect(result.current.rows.map((r) => r.position)).toEqual(span(1, 30).map((r) => r.position))
    expect(result.current).toMatchObject({ hasOlder: false, hasNewer: false })
    expect(result.current.sliceKey).toBeGreaterThan(before)
  })
})
