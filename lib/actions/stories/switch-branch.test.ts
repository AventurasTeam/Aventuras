import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branchEraFlips,
  branches,
  deltas,
  STORY_SETTINGS_DEFAULTS,
  storyDefinitionSchema,
  storyEntries,
  stories,
  type DbCtx,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { setDrainKickSink } from '@/lib/embedder-swap'
import {
  chapterOverlaysStore,
  currentStoryStore,
  entriesStore,
  eraFlipsStore,
  generationStore,
  isUserEditBlocked,
  navigationStore,
  readerHoldStore,
  rehydrateStories,
  resetAllStores,
  storiesStore,
  undoRedoStore,
  type CloseResult,
  type RunState,
} from '@/lib/stores'

import { openStory } from './operational'
import {
  showBranch,
  switchBranch,
  type ShowBranchInput,
  type SwitchBranchInput,
  type SwitchBranchResult,
} from './switch-branch'
import { __redoGroupForTest } from '../delta/redo'

const real = vi.hoisted(() => ({
  rehydrateStories: null as ((db: DbCtx['db']) => Promise<boolean>) | null,
}))

// Call-through spy: a test can fail or hold the stories re-read; every other call reads for real.
vi.mock('@/lib/stores', async (importOriginal) => {
  const actual = await importOriginal<{
    rehydrateStories: (db: DbCtx['db']) => Promise<boolean>
  }>()
  real.rehydrateStories = actual.rehydrateStories
  return { ...actual, rehydrateStories: vi.fn(actual.rehydrateStories) }
})

const readStories = (db: DbCtx['db']): Promise<boolean> => real.rehydrateStories!(db)

const STORY_DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

const CLOSE_RESULT: CloseResult = {
  branchId: 'br_a',
  openSeq: 1,
  chapterId: 'chap_1',
  actionId: 'act_close',
  rerun: false,
  stoppedTasks: 0,
}

type TestDb = DbCtx['db']
type RefusalCode = Extract<SwitchBranchResult, { status: 'refused' }>['code']
type Kick = { storyId: string; published: string | undefined; held: boolean }

const kicks: Kick[] = []

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// story_1 on br_a, opened as the story list opens it (openSeq 1); br_b is its second branch.
async function setup() {
  const test = await createTestDb()
  resetAllStores()
  const ctx = { db: test.db, runInTransaction: vi.fn(test.runInTransaction) }
  const story = {
    status: 'active' as const,
    favorite: 0,
    createdAt: 1,
    updatedAt: 1,
    definition: STORY_DEFINITION,
    settings: STORY_SETTINGS_DEFAULTS,
  }
  await test.db.insert(stories).values([
    { ...story, id: 'story_1', title: 'Aria', currentBranchId: 'br_a' },
    { ...story, id: 'story_2', title: 'Other', currentBranchId: 'br_other' },
  ])
  await test.db.insert(branches).values([
    { id: 'br_a', storyId: 'story_1', name: 'Main', createdAt: 1 },
    {
      id: 'br_b',
      storyId: 'story_1',
      parentBranchId: 'br_a',
      forkEntryId: 'e_a1',
      name: 'Fork',
      createdAt: 2,
    },
    { id: 'br_other', storyId: 'story_2', name: 'Main', createdAt: 1 },
  ])
  await test.db.insert(storyEntries).values([
    {
      id: 'e_a1',
      branchId: 'br_a',
      position: 1,
      kind: 'opening',
      content: 'The keep looms.',
      createdAt: 1,
    },
    {
      id: 'e_b1',
      branchId: 'br_b',
      position: 1,
      kind: 'opening',
      content: 'The road forks.',
      createdAt: 2,
    },
  ])
  await test.db.insert(branchEraFlips).values({
    id: 'ef_b1',
    branchId: 'br_b',
    atWorldtime: 1000,
    eraName: 'Age of Forks',
    createdAt: 2,
  })
  expect(await openStory('story_1', ctx, () => {}, 1)).toEqual({ status: 'ok', branchId: 'br_a' })
  ctx.runInTransaction.mockClear()
  vi.mocked(rehydrateStories).mockClear()
  kicks.length = 0
  setDrainKickSink((storyId) => {
    kicks.push({
      storyId,
      published: currentStoryStore.getCurrentStory()?.branchId,
      held: readerHoldStore.isHeld('br_a'),
    })
  })
  return { db: test.db, sqlite: test.sqlite, ctx }
}

type TestCtx = Awaited<ReturnType<typeof setup>>['ctx']

function input(overrides: Partial<SwitchBranchInput> = {}): SwitchBranchInput {
  return {
    storyId: 'story_1',
    fromBranchId: 'br_a',
    toBranchId: 'br_b',
    isCurrentRequest: () => true,
    replaceStack: () => true,
    ...overrides,
    hold: overrides.hold ?? readerHoldStore.take('br_a'),
  }
}

type StackCall = {
  branchId: string
  held: boolean
  loaded: string | null
  published: string | undefined
}

// Records what the reset saw: it runs before the fill and the publish, under the hold.
function fakeStack(took = true) {
  const calls: StackCall[] = []
  const replaceStack = vi.fn((branchId: string) => {
    calls.push({
      branchId,
      held: readerHoldStore.isHeld('br_a'),
      loaded: entriesStore.getLoadedBranch(),
      published: currentStoryStore.getCurrentStory()?.branchId,
    })
    return took
  })
  return { replaceStack, calls }
}

async function pointer(db: TestDb): Promise<string | null> {
  const [row] = await db
    .select({ branchId: stories.currentBranchId })
    .from(stories)
    .where(eq(stories.id, 'story_1'))
  return row?.branchId ?? null
}

const storiesRowBranch = () =>
  storiesStore.getStories().rows.find((row) => row.id === 'story_1')?.currentBranchId

async function corruptDefinition(db: TestDb): Promise<void> {
  await db
    .update(stories)
    .set({ definition: { leadEntityId: null } as unknown as StoryDefinition })
    .where(eq(stories.id, 'story_1'))
}

async function expectStillOnLeft(db: TestDb): Promise<void> {
  expect(await pointer(db)).toBe('br_a')
  expect(storiesRowBranch()).toBe('br_a')
  expect(entriesStore.getLoadedBranch()).toBe('br_a')
  expect(eraFlipsStore.getLoadedBranch()).toBe('br_a')
  expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_a')
  expect(navigationStore.getNavigation().currentBranchId).toBe('br_a')
  expect(readerHoldStore.isHeld('br_a')).toBe(false)
}

async function expectRefused(
  ctx: TestCtx,
  code: RefusalCode,
  overrides: Partial<SwitchBranchInput> = {},
): Promise<void> {
  const hold = readerHoldStore.take('br_a')
  const stack = fakeStack()
  const result = await switchBranch(
    input({ hold, replaceStack: stack.replaceStack, ...overrides }),
    ctx,
  )
  expect(result).toEqual({ status: 'refused', code })
  expect(await pointer(ctx.db)).toBe('br_a')
  expect(ctx.runInTransaction).not.toHaveBeenCalled()
  expect(stack.replaceStack).not.toHaveBeenCalled()
  expect(readerHoldStore.isHeld('br_a')).toBe(false)
  expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_a')
}

function hardGateRun(runId: string, fields: Partial<RunState> = {}): RunState {
  return {
    runId,
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: `act_${runId}`,
    storyId: 'story_1',
    branchId: 'br_a',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
    ...fields,
  }
}

// A re-run whose abort couldn't take itself back holds its branch until a restart.
function holdUntilRestart(branchId: string): void {
  const runId = `rerun_${branchId}`
  generationStore.startRun(hardGateRun(runId, { branchId, interruptible: 'rerun' }))
  generationStore.abortRun(runId, 'failed', { unreversed: true })
}

beforeEach(() => {
  vi.mocked(rehydrateStories).mockReset()
})

afterEach(() => {
  setDrainKickSink(null)
  vi.restoreAllMocks()
})

describe('switchBranch', () => {
  it('refuses under the gate without the hold: a hard-gate run, a pending turn, a reversal', async () => {
    const { ctx } = await setup()

    generationStore.startRun(hardGateRun('run_turn'))
    await expectRefused(ctx, 'gate')
    generationStore.finishRun('run_turn')

    const turn = deferred()
    const pending = generationStore.bracketPendingTurn('br_b', () => turn.promise)
    await expectRefused(ctx, 'gate')
    turn.resolve()
    await pending

    generationStore.setReversalInProgress(true)
    await expectRefused(ctx, 'gate')
    generationStore.setReversalInProgress(false)
  })

  it.each(['br_a', 'br_b'])(
    'refuses nothing for a branch held until a restart (%s)',
    async (held) => {
      const { db, ctx } = await setup()
      holdUntilRestart(held)
      expect(generationStore.getTxState().heldBranches.has(held)).toBe(true)

      expect(await switchBranch(input(), ctx)).toEqual({ status: 'ok' })
      expect(await pointer(db)).toBe('br_b')
    },
  )

  it('refuses while a turn body still runs on the branch left', async () => {
    const { ctx } = await setup()
    const sweep = deferred()
    const body = generationStore.bracketPendingTurn('br_a', async (endEarly) => {
      endEarly()
      await sweep.promise
    })
    expect(isUserEditBlocked(generationStore.getTxState())).toBe(false)

    await expectRefused(ctx, 'turn-body')
    sweep.resolve()
    await body
    expect(await switchBranch(input(), ctx)).toEqual({ status: 'ok' })
  })

  it("refuses a missing branch and another story's branch", async () => {
    const { ctx } = await setup()
    await expectRefused(ctx, 'missing', { toBranchId: 'br_nope' })
    await expectRefused(ctx, 'missing', { toBranchId: 'br_other' })
  })

  it("refuses a second switch while one runs, leaving the first one's hold", async () => {
    const { db, ctx } = await setup()
    const first = switchBranch(input(), ctx)
    const secondHold = readerHoldStore.take('br_a')

    expect(await switchBranch(input({ hold: secondHold }), ctx)).toEqual({
      status: 'refused',
      code: 'running',
    })
    expect(readerHoldStore.isHeld('br_a')).toBe(true)

    expect(await first).toEqual({ status: 'ok' })
    expect(readerHoldStore.isHeld('br_a')).toBe(false)
    expect(await pointer(db)).toBe('br_b')
  })

  it('moves the pointer and the stories, then in one block replaces the stack, fills and publishes', async () => {
    const { db, ctx } = await setup()
    const liveSettings = { ...STORY_SETTINGS_DEFAULTS }
    currentStoryStore.set({ ...currentStoryStore.getCurrentStory()!, settings: liveSettings })
    chapterOverlaysStore.showCloseResult(CLOSE_RESULT)
    const stack = fakeStack()
    const atFill: { storiesRow: string | null | undefined; published: string | undefined }[] = []
    const off = entriesStore.subscribe(() => {
      if (atFill.length > 0 || entriesStore.getLoadedBranch() !== 'br_b') return
      atFill.push({
        storiesRow: storiesRowBranch(),
        published: currentStoryStore.getCurrentStory()?.branchId,
      })
    })

    const result = await switchBranch(input({ replaceStack: stack.replaceStack }), ctx)
    off()

    expect(result).toEqual({ status: 'ok' })
    expect(await pointer(db)).toBe('br_b')
    expect(stack.calls).toEqual([
      { branchId: 'br_b', held: true, loaded: 'br_a', published: 'br_a' },
    ])
    expect(atFill).toEqual([{ storiesRow: 'br_b', published: 'br_a' }])
    const open = currentStoryStore.getCurrentStory()
    expect(open?.storyId).toBe('story_1')
    expect(open?.branchId).toBe('br_b')
    expect(open?.settings).toBe(liveSettings)
    expect(currentStoryStore.getOpenSeq()).toBe(1)
    expect(navigationStore.getNavigation().currentBranchId).toBe('br_b')
    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
    expect(readerHoldStore.isHeld('br_a')).toBe(false)
    expect([...entriesStore.getEntries('br_b').values()].map((row) => row.id)).toEqual(['e_b1'])
    expect(eraFlipsStore.getLoadedBranch()).toBe('br_b')
    expect([...eraFlipsStore.getEraFlips('br_b').values()].map((row) => row.id)).toEqual(['ef_b1'])
    expect(kicks).toEqual([{ storyId: 'story_1', published: 'br_b', held: false }])
  })

  it('keeps the stores and the published story on the branch left while the stories re-read runs', async () => {
    const { db, ctx } = await setup()
    const reached = deferred()
    const release = deferred()
    vi.mocked(rehydrateStories).mockImplementationOnce(async (database) => {
      reached.resolve()
      await release.promise
      return readStories(database)
    })
    const stack = fakeStack()

    const running = switchBranch(input({ replaceStack: stack.replaceStack }), ctx)
    await reached.promise
    expect(await pointer(db)).toBe('br_b')
    expect(entriesStore.getLoadedBranch()).toBe('br_a')
    expect(eraFlipsStore.getLoadedBranch()).toBe('br_a')
    expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_a')
    expect(stack.replaceStack).not.toHaveBeenCalled()

    release.resolve()
    expect(await running).toEqual({ status: 'ok' })
    expect(entriesStore.getLoadedBranch()).toBe('br_b')
  })

  it('lets a microtask queued from the fill find the publish done and the stack replaced', async () => {
    const { ctx } = await setup()
    const stack = fakeStack()
    let seen: { published: string | undefined; replaced: number } | null = null
    let queued = false
    const off = entriesStore.subscribe(() => {
      if (queued || entriesStore.getLoadedBranch() !== 'br_b') return
      queued = true
      queueMicrotask(() => {
        seen = {
          published: currentStoryStore.getCurrentStory()?.branchId,
          replaced: stack.replaceStack.mock.calls.length,
        }
      })
    })

    await switchBranch(input({ replaceStack: stack.replaceStack }), ctx)
    off()

    expect(seen).toEqual({ published: 'br_b', replaced: 1 })
  })

  it('puts the pointer back and shows nothing new when the read fails', async () => {
    const { db, ctx } = await setup()
    await corruptDefinition(db)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const stack = fakeStack()

    const result = await switchBranch(input({ replaceStack: stack.replaceStack }), ctx)

    expect(result).toEqual({ status: 'failed', code: 'load' })
    await expectStillOnLeft(db)
    expect(stack.replaceStack).not.toHaveBeenCalled()
    expect(kicks).toEqual([])
    expect(error).toHaveBeenCalledWith('action_layer.branch_switch_failed', {
      storyId: 'story_1',
      fromBranchId: 'br_a',
      toBranchId: 'br_b',
      code: 'load',
    })
  })

  it('puts the pointer back when the read throws', async () => {
    const { db, sqlite, ctx } = await setup()
    sqlite.exec('DROP TABLE lore')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const stack = fakeStack()

    const result = await switchBranch(input({ replaceStack: stack.replaceStack }), ctx)

    expect(result).toEqual({ status: 'failed', code: 'load' })
    await expectStillOnLeft(db)
    expect(stack.replaceStack).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'action_layer.branch_switch_failed',
      expect.objectContaining({ storyId: 'story_1', code: 'load', error: expect.any(String) }),
    )
  })

  it('puts the pointer back when the stories re-read fails', async () => {
    const { db, ctx } = await setup()
    vi.mocked(rehydrateStories).mockResolvedValueOnce(false)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const stack = fakeStack()

    const result = await switchBranch(input({ replaceStack: stack.replaceStack }), ctx)

    expect(result).toEqual({ status: 'failed', code: 'stories-reread' })
    await expectStillOnLeft(db)
    expect(stack.replaceStack).not.toHaveBeenCalled()
    expect(vi.mocked(rehydrateStories)).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledWith('action_layer.branch_switch_failed', {
      storyId: 'story_1',
      fromBranchId: 'br_a',
      toBranchId: 'br_b',
      code: 'stories-reread',
    })
  })

  it('puts the pointer back when the stack reset does not take', async () => {
    const { db, ctx } = await setup()
    chapterOverlaysStore.showCloseResult(CLOSE_RESULT)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const stack = fakeStack(false)

    const result = await switchBranch(input({ replaceStack: stack.replaceStack }), ctx)

    expect(result).toEqual({ status: 'failed', code: 'navigation-blocked' })
    expect(stack.replaceStack).toHaveBeenCalledTimes(1)
    await expectStillOnLeft(db)
    expect(chapterOverlaysStore.getState().closeResult).toEqual(CLOSE_RESULT)
    expect(kicks).toEqual([])
    expect(warn).toHaveBeenCalledWith('action_layer.branch_switch_navigation_blocked', {
      storyId: 'story_1',
      fromBranchId: 'br_a',
      toBranchId: 'br_b',
    })
  })

  it('puts the pointer back when the reader goes away right after the pointer write', async () => {
    const { db, ctx } = await setup()
    let current = true
    const abandoning: DbCtx = {
      db: ctx.db,
      runInTransaction: async (ops) => {
        await ctx.runInTransaction(ops)
        current = false
      },
    }
    const stack = fakeStack()

    const result = await switchBranch(
      input({ replaceStack: stack.replaceStack, isCurrentRequest: () => current }),
      abandoning,
    )

    expect(result).toEqual({ status: 'abandoned' })
    expect(ctx.runInTransaction).toHaveBeenCalledTimes(2)
    await expectStillOnLeft(db)
    expect(stack.replaceStack).not.toHaveBeenCalled()
  })

  it('puts the pointer back and re-reads the stories when the reader goes away after the re-read', async () => {
    const { db, ctx } = await setup()
    let current = true
    vi.mocked(rehydrateStories).mockImplementationOnce(async (database) => {
      const read = await readStories(database)
      current = false
      return read
    })
    const stack = fakeStack()

    const result = await switchBranch(
      input({ replaceStack: stack.replaceStack, isCurrentRequest: () => current }),
      ctx,
    )

    expect(result).toEqual({ status: 'abandoned' })
    expect(vi.mocked(rehydrateStories)).toHaveBeenCalledTimes(2)
    await expectStillOnLeft(db)
    expect(stack.replaceStack).not.toHaveBeenCalled()
    expect(kicks).toEqual([])
  })

  it('abandons with nothing to restore when the reader goes away before the pointer write', async () => {
    const { db, ctx } = await setup()

    const result = await switchBranch(input({ isCurrentRequest: () => false }), ctx)

    expect(result).toEqual({ status: 'abandoned' })
    expect(ctx.runInTransaction).not.toHaveBeenCalled()
    expect(vi.mocked(rehydrateStories)).not.toHaveBeenCalled()
    await expectStillOnLeft(db)
  })

  it("writes no delta and leaves every branch's redo stack", async () => {
    const { db, ctx } = await setup()
    const redoA = __redoGroupForTest('br_a')
    const redoB = __redoGroupForTest('br_b')
    undoRedoStore.pushRedoGroup(redoA)
    undoRedoStore.pushRedoGroup(redoB)

    expect(await switchBranch(input(), ctx)).toEqual({ status: 'ok' })

    expect(await db.select().from(deltas)).toEqual([])
    expect(undoRedoStore.peekRedoGroup('br_a')).toBe(redoA)
    expect(undoRedoStore.peekRedoGroup('br_b')).toBe(redoB)
    expect([...undoRedoStore.__branches()].sort()).toEqual(['br_a', 'br_b'])
  })

  it('releases the hold and frees the next switch when the existence read throws', async () => {
    const { ctx } = await setup()
    vi.spyOn(ctx.db, 'select').mockImplementationOnce(() => {
      throw new Error('select failed')
    })

    await expect(switchBranch(input(), ctx)).rejects.toThrow('select failed')

    expect(readerHoldStore.isHeld('br_a')).toBe(false)
    expect(await pointer(ctx.db)).toBe('br_a')
    expect(await switchBranch(input(), ctx)).toEqual({ status: 'ok' })
  })

  it('releases the hold and frees the next switch when the pointer write throws', async () => {
    const { ctx } = await setup()
    const failing: DbCtx = {
      db: ctx.db,
      runInTransaction: () => Promise.reject(new Error('write failed')),
    }

    await expect(switchBranch(input(), failing)).rejects.toThrow('write failed')

    expect(readerHoldStore.isHeld('br_a')).toBe(false)
    expect(await pointer(ctx.db)).toBe('br_a')
    expect(await switchBranch(input(), ctx)).toEqual({ status: 'ok' })
  })
})

describe('showBranch', () => {
  // The caller's own transaction moved the pointer, as a fork's does.
  async function pointerMovedTo(db: TestDb, branchId: string): Promise<void> {
    await db.update(stories).set({ currentBranchId: branchId }).where(eq(stories.id, 'story_1'))
  }

  function show(overrides: Partial<ShowBranchInput> = {}): ShowBranchInput {
    return {
      storyId: 'story_1',
      branchId: 'br_b',
      replaceStack: () => true,
      ...overrides,
      hold: overrides.hold ?? readerHoldStore.take('br_a'),
    }
  }

  it('reads, re-reads, replaces the stack, fills and publishes, and writes no pointer', async () => {
    const { db, ctx } = await setup()
    await pointerMovedTo(db, 'br_b')
    chapterOverlaysStore.showCloseResult(CLOSE_RESULT)
    const stack = fakeStack()

    expect(await showBranch(show({ replaceStack: stack.replaceStack }), ctx)).toEqual({
      status: 'ok',
    })

    expect(stack.calls).toEqual([
      { branchId: 'br_b', held: true, loaded: 'br_a', published: 'br_a' },
    ])
    expect(storiesRowBranch()).toBe('br_b')
    expect(entriesStore.getLoadedBranch()).toBe('br_b')
    expect(eraFlipsStore.getLoadedBranch()).toBe('br_b')
    expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_b')
    expect(currentStoryStore.getOpenSeq()).toBe(1)
    expect(navigationStore.getNavigation().currentBranchId).toBe('br_b')
    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
    expect(readerHoldStore.isHeld('br_a')).toBe(false)
    expect(kicks).toEqual([{ storyId: 'story_1', published: 'br_b', held: false }])
    expect(ctx.runInTransaction).not.toHaveBeenCalled()
    expect(await pointer(db)).toBe('br_b')
  })

  it('still replaces the stack and leaves the pointer when the read fails', async () => {
    const { db, ctx } = await setup()
    await pointerMovedTo(db, 'br_b')
    await corruptDefinition(db)
    chapterOverlaysStore.showCloseResult(CLOSE_RESULT)
    const stack = fakeStack()

    expect(await showBranch(show({ replaceStack: stack.replaceStack }), ctx)).toEqual({
      status: 'shown-unloaded',
    })

    expect(stack.replaceStack).toHaveBeenCalledTimes(1)
    expect(stack.replaceStack).toHaveBeenCalledWith('br_b')
    expect(entriesStore.getLoadedBranch()).toBe('br_a')
    expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_a')
    expect(navigationStore.getNavigation().currentBranchId).toBe('br_a')
    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
    expect(readerHoldStore.isHeld('br_a')).toBe(false)
    expect(kicks).toEqual([])
    expect(ctx.runInTransaction).not.toHaveBeenCalled()
    expect(await pointer(db)).toBe('br_b')
  })

  it('still replaces the stack when the read throws', async () => {
    const { db, sqlite, ctx } = await setup()
    await pointerMovedTo(db, 'br_b')
    sqlite.exec('DROP TABLE lore')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const stack = fakeStack()

    expect(await showBranch(show({ replaceStack: stack.replaceStack }), ctx)).toEqual({
      status: 'shown-unloaded',
    })

    expect(stack.replaceStack).toHaveBeenCalledTimes(1)
    expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_a')
    expect(readerHoldStore.isHeld('br_a')).toBe(false)
    expect(await pointer(db)).toBe('br_b')
    expect(error).toHaveBeenCalledWith(
      'action_layer.branch_show_load_failed',
      expect.objectContaining({ storyId: 'story_1', branchId: 'br_b', error: expect.any(String) }),
    )
  })

  it('logs a failed stories re-read and still publishes and navigates', async () => {
    const { db, ctx } = await setup()
    await pointerMovedTo(db, 'br_b')
    vi.mocked(rehydrateStories).mockResolvedValueOnce(false)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const stack = fakeStack()

    expect(await showBranch(show({ replaceStack: stack.replaceStack }), ctx)).toEqual({
      status: 'ok',
    })

    expect(warn).toHaveBeenCalledWith('action_layer.branch_show_stories_reread_failed', {
      storyId: 'story_1',
      branchId: 'br_b',
    })
    expect(stack.replaceStack).toHaveBeenCalledTimes(1)
    expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_b')
    expect(storiesRowBranch()).toBe('br_a')
    expect(await pointer(db)).toBe('br_b')
  })

  it('fills nothing and leaves the pointer when the stack reset does not take', async () => {
    const { db, ctx } = await setup()
    await pointerMovedTo(db, 'br_b')
    chapterOverlaysStore.showCloseResult(CLOSE_RESULT)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const stack = fakeStack(false)

    expect(await showBranch(show({ replaceStack: stack.replaceStack }), ctx)).toEqual({
      status: 'navigation-blocked',
    })

    expect(warn).toHaveBeenCalledWith('action_layer.branch_show_navigation_blocked', {
      storyId: 'story_1',
      branchId: 'br_b',
    })
    expect(entriesStore.getLoadedBranch()).toBe('br_a')
    expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_a')
    expect(chapterOverlaysStore.getState().closeResult).toEqual(CLOSE_RESULT)
    expect(readerHoldStore.isHeld('br_a')).toBe(false)
    expect(kicks).toEqual([])
    expect(ctx.runInTransaction).not.toHaveBeenCalled()
    expect(await pointer(db)).toBe('br_b')
  })
})
