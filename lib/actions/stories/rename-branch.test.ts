import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { branches, deltas, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  branchesStore,
  generationStore,
  isUserEditBlocked,
  resetAllStores,
  undoRedoStore,
  type RunState,
} from '@/lib/stores'

import { renameBranch } from './rename-branch'
import { __redoGroupForTest } from '../delta/redo'

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values([
    {
      id: 'story_1',
      title: 'Aria',
      status: 'active',
      favorite: 0,
      createdAt: 1,
      updatedAt: 1,
      currentBranchId: 'br_main',
    },
    {
      id: 'story_2',
      title: 'Other',
      status: 'active',
      favorite: 0,
      createdAt: 1,
      updatedAt: 1,
      currentBranchId: 'br_other',
    },
  ])
  await db.insert(branches).values([
    { id: 'br_main', storyId: 'story_1', name: 'Main', createdAt: 1 },
    {
      id: 'br_fork',
      storyId: 'story_1',
      parentBranchId: 'br_main',
      name: 'The road not taken',
      createdAt: 2,
    },
    { id: 'br_other', storyId: 'story_2', name: 'Elsewhere', createdAt: 1 },
  ])
  const write = vi.fn(runInTransaction)
  return { db, write, ctx: { db, runInTransaction: write } }
}

type Db = Awaited<ReturnType<typeof setup>>['db']

async function nameOf(db: Db, branchId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ name: branches.name })
    .from(branches)
    .where(eq(branches.id, branchId))
  return row?.name
}

function startHardGateRun(): void {
  generationStore.startRun({
    runId: 'run_turn',
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_turn',
    storyId: 'story_1',
    branchId: 'br_main',
    abortController: new AbortController(),
    currentPhase: 'narrative',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  } satisfies RunState)
}

describe('renameBranch', () => {
  beforeEach(() => {
    resetAllStores()
  })

  it("writes the name, then refreshes the branch store with the story's rows", async () => {
    const { db, ctx } = await setup()

    expect(
      await renameBranch({ storyId: 'story_1', branchId: 'br_fork', name: 'The trap' }, ctx),
    ).toEqual({ status: 'ok' })

    expect(branchesStore.getBranches('story_1').map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'br_main', name: 'Main' },
      { id: 'br_fork', name: 'The trap' },
    ])
    expect(await nameOf(db, 'br_fork')).toBe('The trap')
  })

  it('stores the name trimmed at its ends, keeping inner whitespace', async () => {
    const { db, ctx } = await setup()

    await renameBranch({ storyId: 'story_1', branchId: 'br_fork', name: '  The trap  ' }, ctx)
    expect(await nameOf(db, 'br_fork')).toBe('The trap')

    await renameBranch({ storyId: 'story_1', branchId: 'br_fork', name: '  The  trap  ' }, ctx)
    expect(await nameOf(db, 'br_fork')).toBe('The  trap')
  })

  it('stores a name a sibling branch already has', async () => {
    const { db, ctx } = await setup()

    expect(
      await renameBranch({ storyId: 'story_1', branchId: 'br_fork', name: 'Main' }, ctx),
    ).toEqual({ status: 'ok' })

    expect(await nameOf(db, 'br_fork')).toBe('Main')
    expect(await nameOf(db, 'br_main')).toBe('Main')
  })

  it.each([
    ['an empty name', ''],
    ['a whitespace-only name', '   '],
  ])('refuses %s before any read or write', async (_label, name) => {
    const { db, write, ctx } = await setup()
    const select = vi.spyOn(db, 'select')

    expect(await renameBranch({ storyId: 'story_1', branchId: 'br_fork', name }, ctx)).toEqual({
      status: 'rejected',
      code: 'empty',
    })

    expect(select).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(await nameOf(db, 'br_fork')).toBe('The road not taken')
  })

  it.each([
    ["another story's branch", 'br_other'],
    ['a branch that does not exist', 'br_gone'],
  ])('refuses %s as missing, writing nothing', async (_label, branchId) => {
    const { db, write, ctx } = await setup()

    expect(await renameBranch({ storyId: 'story_1', branchId, name: 'The trap' }, ctx)).toEqual({
      status: 'rejected',
      code: 'missing',
    })

    expect(write).not.toHaveBeenCalled()
    expect(await nameOf(db, 'br_other')).toBe('Elsewhere')
  })

  // branch-navigator.md → During generation: rename stays live through a run.
  it('renames while a hard-gate run is registered', async () => {
    const { db, ctx } = await setup()
    startHardGateRun()
    expect(isUserEditBlocked(generationStore.getTxState())).toBe(true)

    expect(
      await renameBranch({ storyId: 'story_1', branchId: 'br_fork', name: 'The trap' }, ctx),
    ).toEqual({ status: 'ok' })
    expect(await nameOf(db, 'br_fork')).toBe('The trap')
  })

  it('writes no delta and leaves every redo stack as it was', async () => {
    const { db, ctx } = await setup()
    undoRedoStore.pushRedoGroup(__redoGroupForTest('br_main'))
    undoRedoStore.pushRedoGroup(__redoGroupForTest('br_fork'))

    await renameBranch({ storyId: 'story_1', branchId: 'br_fork', name: 'The trap' }, ctx)

    expect(await db.select().from(deltas)).toEqual([])
    expect(undoRedoStore.hasRedo('br_main')).toBe(true)
    expect(undoRedoStore.hasRedo('br_fork')).toBe(true)
  })

  it('throws a failed write and leaves the name', async () => {
    const { db } = await setup()
    const failing = { db, runInTransaction: () => Promise.reject(new Error('write failed')) }

    await expect(
      renameBranch({ storyId: 'story_1', branchId: 'br_fork', name: 'The trap' }, failing),
    ).rejects.toThrow('write failed')
    expect(await nameOf(db, 'br_fork')).toBe('The road not taken')
  })
})
