import type { NavigationState } from '@react-navigation/native'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { armUnsavedPop, isUnsavedPopArmed } from '@/hooks/leave-guard-chain'
import { replaceStoryStack, type StackContainer } from '@/hooks/use-replace-story-stack'
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
  isStoryBusy,
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

// Stubbed: the real package reaches react-native's Flow source, which the unit bundler can't parse.
vi.mock('@react-navigation/native', () => ({
  CommonActions: { reset: (state: object) => ({ type: 'RESET', payload: state }) },
}))
vi.mock('expo-router', () => ({ useNavigationContainerRef: () => null }))

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

type BlockSeen = {
  loaded: string | null
  published: string | undefined
  replaced: number
  closeResult: CloseResult | null
  held: boolean
}

// What a microtask queued inside the reset-to-release block sees once that block has run.
function blockSeen(replaceStack: { mock: { calls: unknown[] } }): BlockSeen {
  return {
    loaded: entriesStore.getLoadedBranch(),
    published: currentStoryStore.getCurrentStory()?.branchId,
    replaced: replaceStack.mock.calls.length,
    closeResult: chapterOverlaysStore.getState().closeResult,
    held: readerHoldStore.isHeld('br_a'),
  }
}

type NavRoute = { key: string; name: string; params?: object }

// The app Stack under expo-router's root slot. As react-navigation does, a reset that removes a
// route whose guard is armed is prevented and held by that guard, which replays it once released.
function guardedStack(initial: NavRoute[]) {
  let routes = initial
  const held: { payload: { routes: { key?: string; name: string }[] } }[] = []
  const apply = (action: (typeof held)[number]): void => {
    routes = action.payload.routes.map((route, index) => ({
      ...route,
      key: route.key ?? `fresh-${index}`,
    }))
  }
  const dispatch = vi.fn((action: unknown) => {
    const reset = action as (typeof held)[number]
    if (routes.some((route) => isUnsavedPopArmed(route.key))) held.push(reset)
    else apply(reset)
  })
  const container: StackContainer = {
    isReady: () => true,
    getRootState: () =>
      ({
        key: 'root-k',
        index: 0,
        routeNames: ['__root'],
        type: 'stack',
        stale: false,
        routes: [
          {
            key: '__root-k',
            name: '__root',
            state: {
              key: 'stack-k',
              index: routes.length - 1,
              routeNames: [],
              type: 'stack',
              stale: false,
              routes,
            },
          },
        ],
      }) as unknown as NavigationState,
    dispatch,
  }
  return {
    container,
    releaseGuards: () => {
      for (const action of held.splice(0)) apply(action)
    },
    routeKeys: () => routes.map((route) => route.key),
  }
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

// The reader answers current for its first `checks` abandon checks, then has gone.
function currentFor(checks: number): () => boolean {
  let left = checks
  return () => left-- > 0
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

  it('refuses while a run that holds no gate still leaves the story busy', async () => {
    const { ctx } = await setup()

    generationStore.startRun(hardGateRun('run_quiet', { gateBehavior: 'no-gate' }))
    expect(isUserEditBlocked(generationStore.getTxState())).toBe(false)

    await expectRefused(ctx, 'gate')
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
    try {
      await reached.promise
      expect(await pointer(db)).toBe('br_b')
      expect(entriesStore.getLoadedBranch()).toBe('br_a')
      expect(eraFlipsStore.getLoadedBranch()).toBe('br_a')
      expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_a')
      expect(stack.replaceStack).not.toHaveBeenCalled()
    } finally {
      // A failed assertion must not leave the switch parked, registered for every later test.
      release.resolve()
      await running
    }
    expect(await running).toEqual({ status: 'ok' })
    expect(entriesStore.getLoadedBranch()).toBe('br_b')
  })

  it('lets a microtask queued from the reset or the fill find the fill, the publish and the release done', async () => {
    const { ctx } = await setup()
    chapterOverlaysStore.showCloseResult(CLOSE_RESULT)
    const stack = fakeStack()
    const atReset: BlockSeen[] = []
    const atFill: BlockSeen[] = []
    let queued = false
    const replaceStack = vi.fn((branchId: string) => {
      queueMicrotask(() => atReset.push(blockSeen(stack.replaceStack)))
      return stack.replaceStack(branchId)
    })
    const off = entriesStore.subscribe(() => {
      if (queued || entriesStore.getLoadedBranch() !== 'br_b') return
      queued = true
      queueMicrotask(() => atFill.push(blockSeen(stack.replaceStack)))
    })

    expect(await switchBranch(input({ replaceStack }), ctx)).toEqual({ status: 'ok' })
    off()

    const done = { loaded: 'br_b', published: 'br_b', replaced: 1, closeResult: null, held: false }
    expect(atReset).toEqual([done])
    expect(atFill).toEqual([done])
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
      readStatus: 'failed',
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
      cause: 'reset-refused',
    })
  })

  it('puts the pointer back when a run starts on the story during the stories re-read', async () => {
    const { db, ctx } = await setup()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const reached = deferred()
    const release = deferred()
    vi.mocked(rehydrateStories).mockImplementationOnce(async (database) => {
      reached.resolve()
      await release.promise
      return readStories(database)
    })
    const stack = fakeStack()

    const running = switchBranch(input({ replaceStack: stack.replaceStack }), ctx)
    try {
      await reached.promise
      generationStore.startRun(hardGateRun('run_late', { gateBehavior: 'no-gate' }))
    } finally {
      release.resolve()
      await running
    }

    expect(await running).toEqual({ status: 'failed', code: 'navigation-blocked' })
    expect(stack.replaceStack).not.toHaveBeenCalled()
    await expectStillOnLeft(db)
    expect(kicks).toEqual([])
    expect(warn).toHaveBeenCalledWith('action_layer.branch_switch_navigation_blocked', {
      storyId: 'story_1',
      fromBranchId: 'br_a',
      toBranchId: 'br_b',
      cause: 'busy',
    })
  })

  it('puts the pointer back when a turn body starts on the branch left during the stories re-read', async () => {
    const { db, ctx } = await setup()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const reached = deferred()
    const release = deferred()
    vi.mocked(rehydrateStories).mockImplementationOnce(async (database) => {
      reached.resolve()
      await release.promise
      return readStories(database)
    })
    const sweep = deferred()
    const stack = fakeStack()

    const running = switchBranch(input({ replaceStack: stack.replaceStack }), ctx)
    let body: Promise<unknown> = Promise.resolve()
    try {
      await reached.promise
      body = generationStore.bracketPendingTurn('br_a', async (endEarly) => {
        endEarly()
        await sweep.promise
      })
      // The mark has ended early: only the body's own flag still names the branch.
      expect(isStoryBusy(generationStore.getTxState(), 'story_1', 'br_a')).toBe(false)
      expect(generationStore.isTurnBodyActive('br_a')).toBe(true)
    } finally {
      release.resolve()
      await running
      sweep.resolve()
      await body
    }

    expect(await running).toEqual({ status: 'failed', code: 'navigation-blocked' })
    expect(stack.replaceStack).not.toHaveBeenCalled()
    await expectStillOnLeft(db)
    expect(kicks).toEqual([])
    expect(warn).toHaveBeenCalledWith('action_layer.branch_switch_navigation_blocked', {
      storyId: 'story_1',
      fromBranchId: 'br_a',
      toBranchId: 'br_b',
      cause: 'turn-body',
    })
  })

  // The switch's own pointer write is the first transaction; the restore is the second.
  function failingRestores(ctx: TestCtx, failures: number): TestCtx {
    let writes = 0
    return {
      ...ctx,
      runInTransaction: vi.fn(async (ops: Parameters<TestCtx['runInTransaction']>[0]) => {
        writes += 1
        if (writes > 1 && writes <= 1 + failures) throw new Error('disk busy')
        return ctx.runInTransaction(ops)
      }),
    }
  }

  it('retries a restore write that fails once, and warns of the retry with no error', async () => {
    const { db, ctx } = await setup()
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const flaky = failingRestores(ctx, 1)

    const result = await switchBranch(input({ replaceStack: fakeStack(false).replaceStack }), flaky)

    expect(result).toEqual({ status: 'failed', code: 'navigation-blocked' })
    expect(flaky.runInTransaction).toHaveBeenCalledTimes(3)
    await expectStillOnLeft(db)
    expect(warn).toHaveBeenCalledWith('action_layer.branch_switch_restore_retried', {
      storyId: 'story_1',
      fromBranchId: 'br_a',
      toBranchId: 'br_b',
      error: 'disk busy',
    })
    expect(error).not.toHaveBeenCalled()
  })

  it('logs a restore write that fails twice, once, and returns the same result', async () => {
    const { ctx } = await setup()
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const broken = failingRestores(ctx, 2)

    const result = await switchBranch(
      input({ replaceStack: fakeStack(false).replaceStack }),
      broken,
    )

    expect(result).toEqual({ status: 'failed', code: 'navigation-blocked' })
    expect(broken.runInTransaction).toHaveBeenCalledTimes(3)
    expect(
      error.mock.calls.filter(([kind]) => kind === 'action_layer.branch_switch_restore_failed'),
    ).toEqual([
      [
        'action_layer.branch_switch_restore_failed',
        { storyId: 'story_1', fromBranchId: 'br_a', toBranchId: 'br_b', error: 'disk busy' },
      ],
    ])
    expect(readerHoldStore.isHeld('br_a')).toBe(false)
  })

  it('reads the stories again when the re-read after the restore fails once', async () => {
    const { ctx } = await setup()
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    // The switch's own re-read lands br_b in the store; the restore's first re-read fails.
    vi.mocked(rehydrateStories)
      .mockImplementationOnce((database) => readStories(database))
      .mockImplementationOnce(() => Promise.resolve(false))
      .mockImplementation((database) => readStories(database))

    const result = await switchBranch(input({ replaceStack: fakeStack(false).replaceStack }), ctx)

    expect(result).toEqual({ status: 'failed', code: 'navigation-blocked' })
    expect(vi.mocked(rehydrateStories)).toHaveBeenCalledTimes(3)
    expect(storiesRowBranch()).toBe('br_a')
    expect(error).not.toHaveBeenCalled()
  })

  it('logs a re-read after the restore that fails twice, once, and returns the same result', async () => {
    const { ctx } = await setup()
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    // The switch's own re-read lands br_b in the store; both of the restore's re-reads fail.
    vi.mocked(rehydrateStories)
      .mockImplementationOnce((database) => readStories(database))
      .mockResolvedValue(false)

    const result = await switchBranch(input({ replaceStack: fakeStack(false).replaceStack }), ctx)

    expect(result).toEqual({ status: 'failed', code: 'navigation-blocked' })
    expect(vi.mocked(rehydrateStories)).toHaveBeenCalledTimes(3)
    expect(error.mock.calls).toEqual([
      [
        'action_layer.branch_switch_restore_reread_failed',
        { storyId: 'story_1', fromBranchId: 'br_a', toBranchId: 'br_b' },
      ],
    ])
    expect(readerHoldStore.isHeld('br_a')).toBe(false)
  })

  it('puts the pointer back when the stack reset throws', async () => {
    const { db, ctx } = await setup()
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const replaceStack = vi.fn((_branchId: string): boolean => {
      throw new Error('dispatch exploded')
    })

    const result = await switchBranch(input({ replaceStack }), ctx)

    expect(result).toEqual({ status: 'failed', code: 'navigation-blocked' })
    await expectStillOnLeft(db)
    expect(kicks).toEqual([])
    expect(error).toHaveBeenCalledWith('action_layer.branch_switch_failed', {
      storyId: 'story_1',
      fromBranchId: 'br_a',
      toBranchId: 'br_b',
      code: 'navigation-blocked',
      error: 'dispatch exploded',
    })
  })

  it('leaves nothing a guard could replay when an armed buried route refuses the reset', async () => {
    const { db, ctx } = await setup()
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const nav = guardedStack([
      { key: 'list-k', name: 'index' },
      { key: 'settings-k', name: 'story-settings/[storyId]', params: { storyId: 'story_1' } },
      { key: 'reader-a', name: 'reader-composer/[branchId]', params: { branchId: 'br_a' } },
    ])
    const release = armUnsavedPop('settings-k')

    const result = await switchBranch(
      input({ replaceStack: (branchId) => replaceStoryStack(nav.container, branchId) }),
      ctx,
    )

    expect(result).toEqual({ status: 'failed', code: 'navigation-blocked' })
    expect(nav.container.dispatch).not.toHaveBeenCalled()
    await expectStillOnLeft(db)

    release()
    nav.releaseGuards()

    expect(nav.routeKeys()).toEqual(['list-k', 'settings-k', 'reader-a'])
    expect(await pointer(db)).toBe('br_a')
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

  it('resets the stack before a Back taken after the last abandon check can land', async () => {
    const { ctx } = await setup()
    let current = true
    let armed = false
    vi.mocked(rehydrateStories).mockImplementationOnce(async (database) => {
      const read = await readStories(database)
      armed = true
      return read
    })
    const currentAtReset: boolean[] = []
    const replaceStack = vi.fn((_branchId: string) => {
      currentAtReset.push(current)
      return true
    })

    const result = await switchBranch(
      input({
        replaceStack,
        isCurrentRequest: () => {
          if (armed) queueMicrotask(() => (current = false))
          return current
        },
      }),
      ctx,
    )

    expect(result).toEqual({ status: 'ok' })
    expect(currentAtReset).toEqual([true])
  })

  it('abandons with nothing to restore when the reader goes away before the pointer write', async () => {
    const { db, ctx } = await setup()

    const result = await switchBranch(input({ isCurrentRequest: () => false }), ctx)

    expect(result).toEqual({ status: 'abandoned' })
    expect(ctx.runInTransaction).not.toHaveBeenCalled()
    expect(vi.mocked(rehydrateStories)).not.toHaveBeenCalled()
    await expectStillOnLeft(db)
  })

  it('abandons a missing branch once the reader has gone', async () => {
    const { db, ctx } = await setup()

    const result = await switchBranch(
      input({ toBranchId: 'br_nope', isCurrentRequest: () => false }),
      ctx,
    )

    expect(result).toEqual({ status: 'abandoned' })
    expect(ctx.runInTransaction).not.toHaveBeenCalled()
    await expectStillOnLeft(db)
  })

  it('abandons a read that throws after the reader has gone, logged, with the pointer put back', async () => {
    const { db, sqlite, ctx } = await setup()
    sqlite.exec('DROP TABLE lore')
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const stack = fakeStack()

    // Two checks before the read and three inside it pass; lore's read then throws.
    const result = await switchBranch(
      input({ replaceStack: stack.replaceStack, isCurrentRequest: currentFor(5) }),
      ctx,
    )

    expect(result).toEqual({ status: 'abandoned' })
    await expectStillOnLeft(db)
    expect(stack.replaceStack).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'action_layer.branch_switch_failed',
      expect.objectContaining({ storyId: 'story_1', code: 'load', error: expect.any(String) }),
    )
  })

  it('abandons a failed stories re-read after the reader has gone, logged, with the pointer put back', async () => {
    const { db, ctx } = await setup()
    let current = true
    vi.mocked(rehydrateStories).mockImplementationOnce(async () => {
      current = false
      return false
    })
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const stack = fakeStack()

    const result = await switchBranch(
      input({ replaceStack: stack.replaceStack, isCurrentRequest: () => current }),
      ctx,
    )

    expect(result).toEqual({ status: 'abandoned' })
    await expectStillOnLeft(db)
    expect(stack.replaceStack).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('action_layer.branch_switch_failed', {
      storyId: 'story_1',
      fromBranchId: 'br_a',
      toBranchId: 'br_b',
      code: 'stories-reread',
    })
  })

  it('abandons with no failure logged when the reader goes away during the read', async () => {
    const { db, ctx } = await setup()
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const stack = fakeStack()

    // Two checks before the read and its first pass; its second finds the reader gone.
    const result = await switchBranch(
      input({ replaceStack: stack.replaceStack, isCurrentRequest: currentFor(3) }),
      ctx,
    )

    expect(result).toEqual({ status: 'abandoned' })
    expect(ctx.runInTransaction).toHaveBeenCalledTimes(2)
    await expectStillOnLeft(db)
    expect(stack.replaceStack).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalledWith('action_layer.branch_switch_failed', expect.anything())
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

  it('keeps the stores and the published story on the branch left while the stories re-read runs', async () => {
    const { db, ctx } = await setup()
    await pointerMovedTo(db, 'br_b')
    const reached = deferred()
    const release = deferred()
    vi.mocked(rehydrateStories).mockImplementationOnce(async (database) => {
      reached.resolve()
      await release.promise
      return readStories(database)
    })
    const stack = fakeStack()

    const running = showBranch(show({ replaceStack: stack.replaceStack }), ctx)
    try {
      await reached.promise
      expect(entriesStore.getLoadedBranch()).toBe('br_a')
      expect(eraFlipsStore.getLoadedBranch()).toBe('br_a')
      expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_a')
      expect(stack.replaceStack).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await running
    }
    expect(await running).toEqual({ status: 'ok' })
    expect(entriesStore.getLoadedBranch()).toBe('br_b')
  })

  it('lets a microtask queued from the reset or the fill find the fill, the publish and the release done', async () => {
    const { db, ctx } = await setup()
    await pointerMovedTo(db, 'br_b')
    chapterOverlaysStore.showCloseResult(CLOSE_RESULT)
    const atReset: BlockSeen[] = []
    const atFill: BlockSeen[] = []
    let queued = false
    const stack = fakeStack()
    const replaceStack = vi.fn((branchId: string) => {
      queueMicrotask(() => atReset.push(blockSeen(stack.replaceStack)))
      return stack.replaceStack(branchId)
    })
    const off = entriesStore.subscribe(() => {
      if (queued || entriesStore.getLoadedBranch() !== 'br_b') return
      queued = true
      queueMicrotask(() => atFill.push(blockSeen(stack.replaceStack)))
    })

    await showBranch(show({ replaceStack }), ctx)
    off()

    const done = { loaded: 'br_b', published: 'br_b', replaced: 1, closeResult: null, held: false }
    expect(atReset).toEqual([done])
    expect(atFill).toEqual([done])
  })
})

// Back during a switch, then the story's card: the open reads the pointer once the abandoned
// switch has put it back, never the one it wrote.
describe('openStory during a switch', () => {
  async function seedStory() {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Aria',
      status: 'active',
      favorite: 0,
      createdAt: 1,
      updatedAt: 1,
      currentBranchId: 'br_main',
      definition: STORY_DEFINITION,
      settings: STORY_SETTINGS_DEFAULTS,
    })
    await db.insert(branches).values([
      { id: 'br_main', storyId: 'story_1', name: 'Main', createdAt: 1 },
      {
        id: 'br_fork',
        storyId: 'story_1',
        parentBranchId: 'br_main',
        name: 'The road not taken',
        createdAt: 2,
      },
    ])
    return { db, runInTransaction }
  }

  beforeEach(() => {
    resetAllStores()
  })

  it('waits for an abandoned switch to put the pointer back, then opens the branch left', async () => {
    const ctx = await seedStory()
    const written = deferred()
    const writeHeld = deferred()
    let transactions = 0
    // The switch's first transaction is its pointer write: it commits, then the switch waits here.
    const switchCtx: typeof ctx = {
      db: ctx.db,
      runInTransaction: async (ops) => {
        await ctx.runInTransaction(ops)
        transactions += 1
        if (transactions === 1) {
          written.resolve()
          await writeHeld.promise
        }
      },
    }
    let current = true
    const replaceStack = vi.fn<(branchId: string) => boolean>(() => true)
    const navigate = vi.fn<(branchId: string) => void>()

    const switching = switchBranch(
      {
        storyId: 'story_1',
        fromBranchId: 'br_main',
        toBranchId: 'br_fork',
        hold: readerHoldStore.take('br_main'),
        isCurrentRequest: () => current,
        replaceStack,
      },
      switchCtx,
    )
    let pointerDuringSwitch: string | null
    let navigatedDuringSwitch: string[]
    let opening: ReturnType<typeof openStory>
    try {
      await written.promise
      pointerDuringSwitch = await pointer(ctx.db)
      opening = openStory('story_1', ctx, navigate, 999)
      // An open that doesn't wait reads the pointer, loads and navigates within this turn.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      navigatedDuringSwitch = navigate.mock.calls.map(([branchId]) => branchId)
    } finally {
      // Back: the reader that started the switch is gone. Released before any assertion so a
      // failure never leaves a switch registered for a later test.
      current = false
      writeHeld.resolve()
    }

    expect(pointerDuringSwitch).toBe('br_fork')
    expect(navigatedDuringSwitch).toEqual([])
    expect(await switching).toEqual({ status: 'abandoned' })
    expect(await opening).toEqual({ status: 'ok', branchId: 'br_main' })
    expect(navigate.mock.calls).toEqual([['br_main']])
    expect(await pointer(ctx.db)).toBe('br_main')
    expect(currentStoryStore.getCurrentStory()?.branchId).toBe('br_main')
    expect(replaceStack).not.toHaveBeenCalled()
    expect(readerHoldStore.isHeld('br_main')).toBe(false)
  })
})
