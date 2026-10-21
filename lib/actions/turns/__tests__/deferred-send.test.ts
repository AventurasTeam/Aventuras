import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { deltas, happenings, pipelineRuns, storyEntries, type StoryEntry } from '@/lib/db'
import { PER_TURN_KIND, registerPipeline, type PhaseResult, type RunCtx } from '@/lib/pipeline'
import {
  cancelStoryRuns,
  currentStoryStore,
  entriesStore,
  generationStore,
  hydrateAppSettings,
  interruptMemoryRuns,
} from '@/lib/stores'

import { branchEntries, openStory, sseFetch, WORKING_CONFIG } from './fixtures'
import {
  recordDeferrals,
  registerStandInPass,
  registerStoreOnlyRun,
  runningPass,
  standInHappeningId,
  type StandInPass,
} from './stand-in-pass'
import { expectRan, makeHarness, resetSingletons } from '../../../pipeline/__tests__/harness'
import { undoLastAction } from '../../story-entries/undo'
import { regenerateTurn } from '../regenerate-turn'
import { submitTurn } from '../submit-turn'

vi.mock('@/lib/retrieval', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { retrievalSuccess } = await import('@/lib/retrieval/__tests__/outcome')
  return { ...actual, runRetrieval: vi.fn(async () => retrievalSuccess()) }
})

const IDS = { storyId: 's1', branchId: 'b1' }

const OPENING: StoryEntry = {
  id: 'e_opening',
  branchId: 'b1',
  position: 1,
  kind: 'opening',
  content: 'The keep looms over the valley.',
  chapterId: null,
  metadata: null,
  createdAt: 1,
}

type Db = Awaited<ReturnType<typeof makeHarness>>['db']

// Fails in 2 s instead of at the test timeout: an awaited chain would hold the caller, and the
// branch queue, until the pass the turn chained ends.
function within<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within 2 s`)), 2_000)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

// The opening plus one turn is three entries, so a cadence of 3 makes the first turn chain a pass.
async function setUp(cadence: number) {
  const { ctx, db } = await makeHarness()
  await db.insert(storyEntries).values(OPENING)
  await openStory(db, 's1', 'b1')
  const open = currentStoryStore.getCurrentStory()
  if (open == null) throw new Error('story not open')
  currentStoryStore.set({ ...open, settings: { ...open.settings, classifierCadence: cadence } })
  entriesStore.hydrate('b1', [OPENING])
  await hydrateAppSettings(async () => WORKING_CONFIG)
  const pass = registerStandInPass({ anchorEntryId: null })
  return { ctx, db, pass, deferrals: recordDeferrals() }
}

const send = (ctx: RunCtx, content: string) =>
  submitTurn(IDS, { content, composerMode: 'free' }, ctx)

async function chainAPass(ctx: RunCtx, pass: StandInPass) {
  const turn = expectRan(await within(send(ctx, 'I knock.'), 'the turn'))
  return { turn, held: await within(pass.nextHeld(), 'the chained pass') }
}

async function deferAPass(ctx: RunCtx, pass: StandInPass, via: 'regenerate' | 'cancel') {
  const { held } = await chainAPass(ctx, pass)
  if (via === 'cancel') {
    await interruptMemoryRuns('b1')
    return held
  }
  const reply = branchEntries('b1').find((e) => e.kind === 'ai_reply')
  if (!reply) throw new Error('the turn left no reply')
  const regen = await within(regenerateTurn(IDS, reply.id, ctx), 'the regenerate')
  expect(regen.status).toBe('ran')
  return held
}

async function userActionsReading(db: Db, content: string) {
  return db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.content, content)))
}

async function markerOf(db: Db, actionId: string) {
  const [row] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.actionId, actionId))
  return row
}

async function passHappening(db: Db, actionId: string) {
  return db
    .select()
    .from(happenings)
    .where(eq(happenings.id, standInHappeningId(actionId)))
}

describe('Send with deferred work', () => {
  beforeEach(() => {
    resetSingletons()
    vi.stubGlobal('fetch', sseFetch(['A reply.']))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetSingletons()
  })

  it("returns at the turn's commit while the pass the turn chained runs on", async () => {
    const { ctx, db, pass } = await setUp(3)

    const { turn, held } = await chainAPass(ctx, pass)

    expect(turn.outcome).toBe('completed')
    const run = runningPass('b1')
    expect(run?.actionId).toBe(held.actionId)
    expect(held.actionId).not.toBe(turn.actionId)
    expect(held.beforeTurn).toBe(false)
    expect(generationStore.getTxState().pendingTurns.size).toBe(0)
    held.finish('completed')
    await run?.terminal
    expect((await markerOf(db, held.actionId))?.outcome).toBe('completed')
  })

  it('lets a regenerate in while the chained pass runs, which interrupts and defers it', async () => {
    const { ctx, db, pass, deferrals } = await setUp(3)

    const held = await deferAPass(ctx, pass, 'regenerate')

    expect((await markerOf(db, held.actionId))?.outcome).toBe('aborted')
    expect(await passHappening(db, held.actionId)).toEqual([])
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    expect(deferrals).toEqual([
      {
        type: 'run_deferred',
        runId: expect.any(String),
        kind: PERIODIC_CLASSIFIER_KIND,
        branchId: 'b1',
      },
    ])
    // The regenerated turn chains nothing while the work stays deferred.
    expect(runningPass('b1')).toBeUndefined()
    expect(pass.runs).toHaveLength(1)
  })

  it('lets Cancel & leave abort the pass a turn chained after the turn returned, deferring it', async () => {
    const { ctx, db, pass, deferrals } = await setUp(3)
    const { held } = await chainAPass(ctx, pass)
    expect(generationStore.getTxState().pendingTurns.size).toBe(0)

    await within(cancelStoryRuns('s1', 'b1'), 'Cancel & leave')

    expect((await markerOf(db, held.actionId))?.outcome).toBe('aborted')
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    expect(deferrals).toHaveLength(1)
  })

  it('runs the deferred pass first at the next Send, under its mark and before its user action', async () => {
    const { ctx, db, pass } = await setUp(3)
    const interrupted = await deferAPass(ctx, pass, 'regenerate')

    const turn = send(ctx, 'I wait.')
    const deferred = await within(pass.nextHeld(), 'the deferred pass')

    expect(deferred.beforeTurn).toBe(true)
    expect(deferred.actionId).not.toBe(interrupted.actionId)
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    // Send's mark is up, so no reversal interrupts its own deferred work.
    expect(generationStore.isHeadReversalBlocked('b1')).toBe(true)
    expect(await undoLastAction('b1', ctx)).toMatchObject({ status: 'rejected', code: 'gated' })

    deferred.finish('completed')
    const result = expectRan(await within(turn, 'the turn'))

    expect(result.outcome).toBe('completed')
    expect(result.actionId).not.toBe(deferred.actionId)
    expect(generationStore.getTxState().deferred.get('b1')).toBeUndefined()
    const passDeltas = await db.select().from(deltas).where(eq(deltas.actionId, deferred.actionId))
    expect(passDeltas).toHaveLength(1)
    const [userAction] = await userActionsReading(db, 'I wait.')
    const [userActionCreate] = await db
      .select()
      .from(deltas)
      .where(and(eq(deltas.targetId, userAction.id), eq(deltas.op, 'create')))
    expect(userActionCreate.actionId).toBe(result.actionId)
    expect(passDeltas.every((d) => d.logPosition < userActionCreate.logPosition)).toBe(true)
    // The deferred pass advanced the watermark, so the turn's two entries leave the cadence short.
    expect(runningPass('b1')).toBeUndefined()
  })

  it('cancels the whole Send when its deferred pass is cancelled, keeping the work deferred', async () => {
    const { ctx, db, pass, deferrals } = await setUp(3)
    await deferAPass(ctx, pass, 'cancel')

    const turn = send(ctx, 'I wait.')
    const deferred = await within(pass.nextHeld(), 'the deferred pass')
    await interruptMemoryRuns('b1')
    const result = await within(turn, 'the cancelled Send')

    expect(result).toMatchObject({ outcome: 'aborted', actionId: deferred.actionId })
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(branchEntries('b1').some((e) => e.content === 'I wait.')).toBe(false)
    expect(
      await db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, PER_TURN_KIND)),
    ).toHaveLength(1)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    // Cancelling work that was already deferred moves nothing new to the next turn.
    expect(deferrals).toHaveLength(1)
  })

  it('cancels the whole Send when Cancel & leave lands during its deferred pass', async () => {
    const { ctx, db, pass } = await setUp(3)
    await deferAPass(ctx, pass, 'cancel')

    const turn = send(ctx, 'I wait.')
    const deferred = await within(pass.nextHeld(), 'the deferred pass')
    await within(cancelStoryRuns('s1', 'b1'), 'Cancel & leave')
    // Leaving waits out the Send's whole body, not just the pass it was running.
    expect(generationStore.getTxState().pendingTurns.size).toBe(0)
    const result = await within(turn, 'the cancelled Send')

    expect(result).toMatchObject({ outcome: 'aborted', actionId: deferred.actionId })
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
  })

  it("lets the turn run when its deferred pass fails, and the turn's commit chains the retry", async () => {
    const { ctx, db, pass } = await setUp(3)
    await deferAPass(ctx, pass, 'cancel')

    const turn = send(ctx, 'I wait.')
    const deferred = await within(pass.nextHeld(), 'the deferred pass')
    deferred.finish('failed')
    const result = expectRan(await within(turn, 'the turn'))

    expect(result.outcome).toBe('completed')
    expect((await markerOf(db, deferred.actionId))?.outcome).toBe('failed')
    expect(await passHappening(db, deferred.actionId)).toEqual([])
    expect(await userActionsReading(db, 'I wait.')).toHaveLength(1)
    expect(generationStore.getTxState().deferred.get('b1')).toBeUndefined()
    const retry = await within(pass.nextHeld(), 'the retry')
    expect(retry.beforeTurn).toBe(false)
    expect(retry.actionId).not.toBe(deferred.actionId)
    expect(retry.actionId).not.toBe(result.actionId)
    const run = runningPass('b1')
    retry.finish('completed')
    await run?.terminal
  })

  it('lets the turn run and keeps the work deferred when the deferred pass cannot start', async () => {
    const { ctx, pass } = await setUp(3)
    await deferAPass(ctx, pass, 'cancel')
    // Blocks the pass (its blockedBy lists it) and not the turn; registered because the turn's
    // start reads every current run's yieldsTo.
    registerPipeline({
      kind: 'translation-retry',
      phases: [
        {
          name: 'retry',
          run: async function* (): AsyncGenerator<never, PhaseResult> {
            return { status: 'completed' }
          },
        },
      ],
      affordance: 'invisible',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    })
    const blocker = registerStoreOnlyRun('translation-retry', 'b1')

    const result = expectRan(await within(send(ctx, 'I wait.'), 'the turn'))

    expect(result.outcome).toBe('completed')
    expect(pass.runs).toHaveLength(1)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    generationStore.abortRun(blocker.runId)
  })

  it('runs no pass before a turn when nothing is deferred', async () => {
    const { ctx, db, pass } = await setUp(50)

    const result = expectRan(await within(send(ctx, 'I knock.'), 'the turn'))

    expect(result.outcome).toBe('completed')
    expect(pass.runs).toEqual([])
    expect(
      await db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, PERIODIC_CLASSIFIER_KIND)),
    ).toEqual([])
  })
})
