import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PipelineAction } from '@/lib/actions'
import { runClassifierNow } from '@/lib/actions/classifier/run-now'
import {
  STORY_DEFINITION,
  STORY_SETTINGS,
  WORKING_CONFIG,
} from '@/lib/actions/turns/__tests__/fixtures'
import { generateStructured } from '@/lib/ai'
import { idleStatus, PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, pipelineRuns, stories, storyEntries, type ClassifierStatus } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  currentStoryStore,
  entitiesStore,
  generationStore,
  hydrateAppSettings,
  type RunState,
} from '@/lib/stores'

import { __resetClassifierEmbedder } from './description-embedder'
import { nextMemoryRun, readClassifierStatus, unprocessedEntryCount } from './memory-chain'
import { PER_TURN_KIND } from './per-turn'
import { ensurePeriodicClassifierPipelineRegistered } from './periodic-classifier'
import { expectRan, makeHarness, resetSingletons } from '../__tests__/harness'
import { definePipeline } from '../authoring/define'
import { runPipeline } from '../runtime/orchestrator'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: vi.fn(),
}))

type Db = Awaited<ReturnType<typeof makeHarness>>['db']

const EMPTY_REPLY = {
  happenings: [],
  relationships: [],
  statusFlips: [],
  newCharacters: [],
  aliases: [],
  newFactions: [],
  memberships: [],
}

function openStory(
  cadence: number,
  open: { storyId: string; branchId: string } = { storyId: 's1', branchId: 'b1' },
): void {
  currentStoryStore.set({
    ...open,
    definition: STORY_DEFINITION,
    settings: { ...STORY_SETTINGS, classifierCadence: cadence },
  })
  entitiesStore.hydrate(open.branchId, [])
}

function turnRun(over: Partial<RunState> = {}): RunState {
  return {
    runId: 'run_turn',
    kind: PER_TURN_KIND,
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_turn',
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
    ...over,
  }
}

async function seedEntries(db: Db, count: number): Promise<void> {
  for (let position = 1; position <= count; position++)
    await db.insert(storyEntries).values({
      id: `e${position}`,
      branchId: 'b1',
      position,
      kind: position % 2 === 1 ? 'user_action' : 'ai_reply',
      content: `entry ${position}`,
      createdAt: position,
    })
}

async function setStatus(db: Db, status: Partial<ClassifierStatus>): Promise<void> {
  await db
    .update(branches)
    .set({ classifierStatus: { ...idleStatus(), ...status } })
    .where(eq(branches.id, 'b1'))
}

let nextPosition = 1

function entry(kind: 'user_action' | 'ai_reply'): PhaseEmittedEvent {
  const position = nextPosition++
  const action: PipelineAction = {
    kind: 'createStoryEntry',
    source: 'ai_classifier',
    payload: {
      entry: {
        id: `e${position}`,
        branchId: 'b1',
        position,
        kind,
        content: `entry ${position}`,
        createdAt: position,
      },
    },
  }
  return { type: 'delta_emitted', action }
}

// Stands in for per-turn, chaining as it does.
function defineTurn(end: PhaseResult = { status: 'completed' }): void {
  async function* writeTurn(): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
    yield entry('user_action')
    yield entry('ai_reply')
    return end
  }
  definePipeline({
    kind: PER_TURN_KIND,
    phases: [{ name: 'narrative', run: writeTurn }],
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
    concurrencyPolicy: { blockedBy: [PER_TURN_KIND, PERIODIC_CLASSIFIER_KIND] },
    chainsTo: nextMemoryRun,
  })
}

function defineRecordingPass(): string[] {
  const actionIds: string[] = []
  async function* classify(ctx: PhaseContext): AsyncGenerator<never, PhaseResult> {
    actionIds.push(ctx.actionId)
    return { status: 'completed' }
  }
  definePipeline({
    kind: PERIODIC_CLASSIFIER_KIND,
    phases: [{ name: 'classify', run: classify }],
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
    interruptible: 'pass',
    concurrencyPolicy: {},
  })
  return actionIds
}

beforeEach(() => {
  vi.resetAllMocks()
  resetSingletons()
  __resetClassifierEmbedder()
  nextPosition = 1
})

describe('unprocessedEntryCount', () => {
  // Differencing MAX(position) against the watermark instead would count the
  // technical rows the window filters out, firing the cadence early.
  it('counts classifiable turns past the watermark, ignoring system rows', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    const kinds = ['ai_reply', 'system', 'user_input', 'system', 'ai_reply'] as const
    for (const [i, kind] of kinds.entries())
      await db.insert(storyEntries).values({
        id: `e${i + 1}`,
        branchId: 'b1',
        position: i + 1,
        kind,
        content: 'x',
        chapterId: null,
        metadata: {},
        createdAt: 1,
      } as never)

    expect(await unprocessedEntryCount('b1', null, { db, runInTransaction })).toBe(3)
    expect(await unprocessedEntryCount('b1', 2, { db, runInTransaction })).toBe(2)
    expect(await unprocessedEntryCount('b1', 5, { db, runInTransaction })).toBe(0)
  })
})

describe('readClassifierStatus', () => {
  it('reads the stored status, and idle for a branch never classified', async () => {
    const { db, ctx } = await makeHarness()
    expect(await readClassifierStatus('b1', ctx)).toEqual(idleStatus())

    await setStatus(db, {
      state: 'retrying',
      retryCount: 2,
      lastError: 'boom',
      processedThrough: 4,
    })

    expect(await readClassifierStatus('b1', ctx)).toEqual({
      ...idleStatus(),
      state: 'retrying',
      retryCount: 2,
      lastError: 'boom',
      processedThrough: 4,
    })
  })
})

describe('nextMemoryRun', () => {
  it('names a pass once the unprocessed entries reach the open story’s cadence', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 2)

    openStory(3)
    expect(await nextMemoryRun(turnRun(), ctx)).toBeNull()
    openStory(2)
    expect(await nextMemoryRun(turnRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
  })

  it('counts only past the watermark', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 4)
    await setStatus(db, { processedThrough: 3 })

    openStory(2)
    expect(await nextMemoryRun(turnRun(), ctx)).toBeNull()
    openStory(1)
    expect(await nextMemoryRun(turnRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
  })

  it.each([
    [PERIODIC_CLASSIFIER_KIND, 'pass', { pass: true }],
    ['chapter-close', 'close', { close: true }],
  ] as const)(
    'names nothing while the branch holds deferred work (%s)',
    async (kind, slot, recorded) => {
      const { db, ctx } = await makeHarness()
      await seedEntries(db, 2)
      openStory(2)
      const interrupted = turnRun({ runId: `run_${kind}`, kind, interruptible: slot })
      generationStore.startRun(interrupted)
      expect(generationStore.abortRun(interrupted.runId, 'aborted')).toBe(slot)
      expect(generationStore.getTxState().deferred.get('b1')).toEqual(recorded)

      expect(await nextMemoryRun(turnRun(), ctx)).toBeNull()
    },
  )

  it('ignores work deferred on another branch', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 2)
    openStory(2)
    const elsewhere = turnRun({
      runId: 'run_elsewhere',
      kind: PERIODIC_CLASSIFIER_KIND,
      interruptible: 'pass',
      branchId: 'b2',
    })
    generationStore.startRun(elsewhere)
    expect(generationStore.abortRun(elsewhere.runId, 'aborted')).toBe('pass')

    expect(await nextMemoryRun(turnRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
  })

  it.each([
    ['failed-persistent', { state: 'failed-persistent', retryCount: 3, lastError: 'boom' }],
    ['running, as a crash left it', { state: 'running' }],
  ] as const)('names nothing while the status is %s', async (_label, status) => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 4)
    await setStatus(db, status)
    openStory(1)

    expect(await nextMemoryRun(turnRun(), ctx)).toBeNull()
  })

  it('retries a retrying pass at the next due commit', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 2)
    await setStatus(db, { state: 'retrying', retryCount: 2, lastError: 'rate limited' })
    openStory(2)

    expect(await nextMemoryRun(turnRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
  })

  it.each([
    ['another branch of the story', { storyId: 's1', branchId: 'b2' }],
    ['another story', { storyId: 's2', branchId: 'b1' }],
  ])('names nothing when the open story is %s', async (_label, open) => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 2)
    openStory(1, open)

    expect(await nextMemoryRun(turnRun(), ctx)).toBeNull()
  })

  it('names nothing when no story is open', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 2)

    expect(await nextMemoryRun(turnRun(), ctx)).toBeNull()
  })
})

describe('per-turn chains the pass through the orchestrator', () => {
  it('chains a pass with its own actionId when the turn brings the cadence due', async () => {
    const { db, ctx } = await makeHarness()
    openStory(2)
    defineTurn()
    const passActionIds = defineRecordingPass()

    const turn = expectRan(await runPipeline(PER_TURN_KIND, { ...ctx, actionId: 'act_turn' }))

    expect(turn).toMatchObject({ outcome: 'completed', actionId: 'act_turn' })
    expect(passActionIds).toHaveLength(1)
    expect(passActionIds[0]).not.toBe('act_turn')
    const markers = await db
      .select({
        kind: pipelineRuns.kind,
        actionId: pipelineRuns.actionId,
        outcome: pipelineRuns.outcome,
      })
      .from(pipelineRuns)
    expect(markers).toHaveLength(2)
    expect(markers).toEqual(
      expect.arrayContaining([
        { kind: PER_TURN_KIND, actionId: 'act_turn', outcome: 'completed' },
        { kind: PERIODIC_CLASSIFIER_KIND, actionId: passActionIds[0], outcome: 'completed' },
      ]),
    )
  })

  // Only commitRun evaluates chainsTo; the entries seeded before the turn survive its reversal.
  it.each([
    ['failed', { status: 'failed', error: { kind: 'phase-logic', detail: 'boom' } }],
    ['aborted', { status: 'aborted' }],
  ] as const)(
    'chains nothing when the turn %s, though the cadence is due',
    async (outcome, end) => {
      const { db, ctx } = await makeHarness()
      await seedEntries(db, 2)
      nextPosition = 3
      openStory(2)
      defineTurn(end)
      const passActionIds = defineRecordingPass()

      expect(expectRan(await runPipeline(PER_TURN_KIND, ctx)).outcome).toBe(outcome)

      expect(passActionIds).toEqual([])
      expect(
        await db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, PERIODIC_CLASSIFIER_KIND)),
      ).toEqual([])
      expect(await nextMemoryRun(turnRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
    },
  )

  it('chains nothing when the turn leaves the count below the cadence', async () => {
    const { db, ctx } = await makeHarness()
    openStory(3)
    defineTurn()
    const passActionIds = defineRecordingPass()

    expectRan(await runPipeline(PER_TURN_KIND, ctx))

    expect(passActionIds).toEqual([])
    expect(
      await db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, PERIODIC_CLASSIFIER_KIND)),
    ).toEqual([])
  })

  it('retries a failing pass at each due commit, holds it at failed-persistent, and Run now resumes it', async () => {
    const { ctx } = await makeHarness()
    await hydrateAppSettings(async () => WORKING_CONFIG)
    openStory(2)
    defineTurn()
    ensurePeriodicClassifierPipelineRegistered()
    vi.mocked(generateStructured).mockResolvedValue({ status: 'failed', detail: 'rate limited' })

    const states: ClassifierStatus['state'][] = []
    for (let turn = 0; turn < 5; turn++) {
      expectRan(await runPipeline(PER_TURN_KIND, ctx))
      states.push((await readClassifierStatus('b1', ctx)).state)
    }

    expect(states).toEqual([
      'retrying',
      'retrying',
      'retrying',
      'failed-persistent',
      'failed-persistent',
    ])
    expect(generateStructured).toHaveBeenCalledTimes(4)
    expect(await readClassifierStatus('b1', ctx)).toMatchObject({
      retryCount: 3,
      lastError: 'rate limited',
      processedThrough: null,
    })

    vi.mocked(generateStructured).mockResolvedValue({ status: 'ok', value: EMPTY_REPLY })
    expect(
      await runClassifierNow('b1', { db: ctx.db, runInTransaction: ctx.runInTransaction }),
    ).toMatchObject({ outcome: 'completed' })
    expect(await readClassifierStatus('b1', ctx)).toMatchObject({
      state: 'idle',
      retryCount: 0,
      lastError: null,
      processedThrough: 10,
    })

    expectRan(await runPipeline(PER_TURN_KIND, ctx))
    expect(generateStructured).toHaveBeenCalledTimes(6)
  })
})
