import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { idleStatus, PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import {
  branches,
  chapters,
  deltas,
  happenings,
  pipelineRuns,
  storyEntries,
  type StoryEntry,
} from '@/lib/db'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  isClassifierHeld,
  PER_TURN_KIND,
  registerPipeline,
  startPipeline,
  type PhaseResult,
  type RunCtx,
  type TxResult,
} from '@/lib/pipeline'
import {
  cancelStoryRuns,
  currentStoryStore,
  entriesStore,
  generationStore,
  hydrateAppSettings,
  interruptMemoryRuns,
} from '@/lib/stores'

import { branchEntries, openStory, sseFetch, WORKING_CONFIG } from './fixtures'
import { registerStandInClose, type HeldClose, type StandInClose } from './stand-in-close'
import {
  failReversalsOf,
  recordDeferrals,
  recordDeferred,
  registerStandInPass,
  registerStoreOnlyRun,
  runningPass,
  standInHappeningId,
  type HeldPass,
  type StandInPass,
  type StandInPassOptions,
} from './stand-in-pass'
import {
  expectRan,
  makeHarness,
  resetSingletons,
  within,
} from '../../../pipeline/__tests__/harness'
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
  contentTokens: null,
  chapterId: null,
  metadata: null,
  createdAt: 1,
}

// One turn past a NULL watermark with nothing deferred: what a restart leaves of a pass the
// cadence owes (classifier.md → Failure policy).
const BACKLOG: readonly StoryEntry[] = [
  OPENING,
  {
    ...OPENING,
    id: 'e_u0',
    position: 2,
    kind: 'user_action',
    content: 'I climb the stair.',
    createdAt: 2,
  },
  {
    ...OPENING,
    id: 'e_r0',
    position: 3,
    kind: 'ai_reply',
    content: 'The stair narrows.',
    createdAt: 3,
  },
]

// A row written with no count reads 0 tokens, which no threshold reaches: 300 across the backlog.
const COUNTED_BACKLOG: readonly StoryEntry[] = BACKLOG.map((row) => ({
  ...row,
  contentTokens: 100,
}))
const OWED_AT = 300

type Db = Awaited<ReturnType<typeof makeHarness>>['db']

function setCadence(cadence: number): void {
  const open = currentStoryStore.getCurrentStory()
  if (open == null) throw new Error('story not open')
  currentStoryStore.set({ ...open, settings: { ...open.settings, classifierCadence: cadence } })
}

// The opening plus one turn is three entries, so a cadence of 3 makes the first turn chain a pass.
async function setUp(
  cadence: number,
  rows: readonly StoryEntry[] = [OPENING],
  passOptions: Omit<StandInPassOptions, 'anchorEntryId'> = {},
  closeOptions: { leaveOpen?: true } = {},
) {
  const { ctx, db } = await makeHarness()
  await db.insert(storyEntries).values([...rows])
  await openStory(db, 's1', 'b1')
  setCadence(cadence)
  entriesStore.hydrate('b1', [...rows])
  await hydrateAppSettings(async () => WORKING_CONFIG)
  const pass = registerStandInPass({ anchorEntryId: null, ...passOptions })
  const close = registerStandInClose(closeOptions)
  return { ctx, db, pass, close, deferrals: recordDeferrals() }
}

function setThreshold(tokens: number): void {
  const open = currentStoryStore.getCurrentStory()
  if (open == null) throw new Error('story not open')
  currentStoryStore.set({ ...open, settings: { ...open.settings, chapterTokenThreshold: tokens } })
}

async function setWatermark(db: Db, processedThrough: number | null): Promise<void> {
  await db
    .update(branches)
    .set({ classifierStatus: { ...idleStatus(), processedThrough } })
    .where(eq(branches.id, 'b1'))
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

// Aborts the turn as it registers, after its user action was written.
function cancelTheTurnOnStart(branchId: string): void {
  const off = generationStore.subscribe(() => {
    const turn = [...generationStore.getTxState().runs.values()].find(
      (r) => r.branchId === branchId && r.kind === PER_TURN_KIND,
    )
    if (turn == null) return
    off()
    turn.abortController.abort()
  })
}

// A persisted `running` with no pass of this process on the branch: a pass whose reversal failed.
async function holdTheBranch(db: Db): Promise<void> {
  await db
    .update(branches)
    .set({ classifierStatus: { ...idleStatus(), state: 'running' } })
    .where(eq(branches.id, 'b1'))
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

async function turnMarkers(db: Db) {
  return db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, PER_TURN_KIND))
}

async function passHappening(db: Db, actionId: string) {
  return db
    .select()
    .from(happenings)
    .where(eq(happenings.id, standInHappeningId(actionId)))
}

async function closeMarkers(db: Db) {
  return db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, CHAPTER_CLOSE_KIND))
}

// Sends, finishing each of Send's owed runs in order while no user action exists yet.
async function sendThrough(
  ctx: RunCtx,
  db: Db,
  stands: { pass: StandInPass; close: StandInClose },
  owed: readonly ('pass' | 'close')[],
): Promise<{ result: TxResult; ran: (HeldPass | HeldClose)[] }> {
  const turn = send(ctx, 'I wait.')
  const ran: (HeldPass | HeldClose)[] = []
  for (const work of owed) {
    const held = await within(
      work === 'pass' ? stands.pass.nextHeld() : stands.close.nextHeld(),
      `Send's owed ${work}`,
    )
    expect(held.beforeTurn).toBe(true)
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    ran.push(held)
    held.finish('completed')
  }
  return { result: expectRan(await within(turn, 'the turn')), ran }
}

// Each owed run wrote its own group, all of it before the user action.
async function expectWritesBeforeTurn(
  db: Db,
  ran: readonly { actionId: string }[],
  turn: TxResult,
): Promise<void> {
  const [userAction] = await userActionsReading(db, 'I wait.')
  const [create] = await db
    .select()
    .from(deltas)
    .where(and(eq(deltas.targetId, userAction.id), eq(deltas.op, 'create')))
  expect(create.actionId).toBe(turn.actionId)
  expect(new Set([...ran.map((r) => r.actionId), turn.actionId]).size).toBe(ran.length + 1)
  for (const run of ran) {
    const written = await db.select().from(deltas).where(eq(deltas.actionId, run.actionId))
    expect(written.length).toBeGreaterThan(0)
    expect(written.every((d) => d.logPosition < create.logPosition)).toBe(true)
  }
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
        work: 'pass',
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

  it('runs a pass the cadence owes first, with nothing deferred, as after a restart', async () => {
    const { ctx, db, pass } = await setUp(3, BACKLOG)
    expect(generationStore.getTxState().deferred.size).toBe(0)

    const turn = send(ctx, 'I wait.')
    const owed = await within(pass.nextHeld(), 'the owed pass')

    expect(owed.beforeTurn).toBe(true)
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    owed.finish('completed')
    const result = expectRan(await within(turn, 'the turn'))

    expect(result.outcome).toBe('completed')
    expect(result.actionId).not.toBe(owed.actionId)
    const passDeltas = await db.select().from(deltas).where(eq(deltas.actionId, owed.actionId))
    expect(passDeltas).toHaveLength(1)
    const [userAction] = await userActionsReading(db, 'I wait.')
    const [userActionCreate] = await db
      .select()
      .from(deltas)
      .where(and(eq(deltas.targetId, userAction.id), eq(deltas.op, 'create')))
    expect(passDeltas.every((d) => d.logPosition < userActionCreate.logPosition)).toBe(true)
    // The owed pass moved the watermark to the backlog's tail, so the turn's two entries chain none.
    expect(pass.runs).toHaveLength(1)
    expect(runningPass('b1')).toBeUndefined()
  })

  it('cancels the whole Send when its deferred pass is cancelled, keeping the work deferred', async () => {
    const { ctx, db, pass, deferrals } = await setUp(3)
    await deferAPass(ctx, pass, 'cancel')

    const turn = send(ctx, 'I wait.')
    const deferred = await within(pass.nextHeld(), 'the deferred pass')
    await interruptMemoryRuns('b1')
    const result = await within(turn, 'the cancelled Send')

    // Before the turn's first write, so the host knows nothing it cleared beforehand moved.
    expect(result).toMatchObject({
      outcome: 'aborted',
      actionId: deferred.actionId,
      beforeTurn: true,
      work: 'pass',
    })
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(branchEntries('b1').some((e) => e.content === 'I wait.')).toBe(false)
    expect(
      await db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, PER_TURN_KIND)),
    ).toHaveLength(1)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    // Cancelling work that was already deferred moves nothing new to the next turn.
    expect(deferrals).toHaveLength(1)
  })

  it('cancels the whole Send when the pass the cadence owes is cancelled, deferring it', async () => {
    const { ctx, db, pass, deferrals } = await setUp(3, BACKLOG)

    const turn = send(ctx, 'I wait.')
    const owed = await within(pass.nextHeld(), 'the owed pass')
    await interruptMemoryRuns('b1')
    const result = await within(turn, 'the cancelled Send')

    expect(result).toMatchObject({
      outcome: 'aborted',
      actionId: owed.actionId,
      beforeTurn: true,
      work: 'pass',
    })
    expect(result).not.toHaveProperty('committed')
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(await passHappening(db, owed.actionId)).toEqual([])
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
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

    expect(result).toMatchObject({
      outcome: 'aborted',
      actionId: deferred.actionId,
      beforeTurn: true,
      work: 'pass',
    })
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
  })

  // The pass ignored a Cancel landing in its last phase and committed; the Send is still cancelled.
  it('cancels the Send when Cancel lands after its owed pass ended its last phase', async () => {
    const { ctx, db, pass } = await setUp(3, BACKLOG)

    const sent = send(ctx, 'I wait.')
    const held = await within(pass.nextHeld(), 'the owed pass')
    held.finish('completed')
    const interrupted = interruptMemoryRuns('b1')
    const result = await within(sent, 'the cancelled Send')
    await interrupted

    expect(result).toMatchObject({
      outcome: 'aborted',
      actionId: held.actionId,
      beforeTurn: true,
      work: 'pass',
      committed: true,
    })
    expect((await markerOf(db, held.actionId))?.outcome).toBe('completed')
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(await turnMarkers(db)).toEqual([])
  })

  it('marks no cancel of the turn itself as before the turn', async () => {
    const { ctx, db } = await setUp(50)
    cancelTheTurnOnStart('b1')

    const result = await within(send(ctx, 'I wait.'), 'the cancelled turn')

    expect(result.outcome).toBe('aborted')
    expect(result).not.toHaveProperty('beforeTurn')
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
  })

  it('fails the Send when its deferred pass fails, keeping the work deferred for the next Send', async () => {
    const { ctx, db, pass } = await setUp(3)
    await deferAPass(ctx, pass, 'cancel')
    // A cadence of 50 isn't due, so only the kept deferral can owe the next Send its pass.
    setCadence(50)

    const failed = send(ctx, 'I wait.')
    const deferred = await within(pass.nextHeld(), 'the deferred pass')
    deferred.finish('failed')
    const result = await within(failed, 'the failed Send')

    expect(result).toMatchObject({
      outcome: 'failed',
      actionId: deferred.actionId,
      beforeTurn: true,
      work: 'pass',
    })
    expect(result).toHaveProperty('error', { kind: 'phase-logic', detail: 'stand-in pass failed' })
    expect((await markerOf(db, deferred.actionId))?.outcome).toBe('failed')
    expect(await passHappening(db, deferred.actionId)).toEqual([])
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(await turnMarkers(db)).toHaveLength(1)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    expect(generationStore.getTxState().pendingTurns.size).toBe(0)

    const resent = send(ctx, 'I wait.')
    const again = await within(pass.nextHeld(), 'the deferred pass, run first again')
    expect(again.beforeTurn).toBe(true)
    expect(again.actionId).not.toBe(deferred.actionId)
    again.finish('completed')

    expect(expectRan(await within(resent, 'the turn')).outcome).toBe('completed')
    expect(await userActionsReading(db, 'I wait.')).toHaveLength(1)
    expect(generationStore.getTxState().deferred.get('b1')).toBeUndefined()
  })

  it('fails the Send when the pass the cadence owes fails, and the next Send runs it first again', async () => {
    const { ctx, db, pass, deferrals } = await setUp(3, BACKLOG)

    const failed = send(ctx, 'I wait.')
    const owed = await within(pass.nextHeld(), 'the owed pass')
    owed.finish('failed')
    const result = await within(failed, 'the failed Send')

    expect(result).toMatchObject({
      outcome: 'failed',
      actionId: owed.actionId,
      beforeTurn: true,
      work: 'pass',
    })
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(await turnMarkers(db)).toEqual([])
    // A failure records no deferral: the watermark, still behind, owes the next Send the pass.
    expect(generationStore.getTxState().deferred.size).toBe(0)
    expect(deferrals).toEqual([])

    const resent = send(ctx, 'I wait.')
    const again = await within(pass.nextHeld(), 'the owed pass, run first again')
    expect(again.beforeTurn).toBe(true)
    again.finish('completed')

    expect(expectRan(await within(resent, 'the turn')).outcome).toBe('completed')
    expect(await userActionsReading(db, 'I wait.')).toHaveLength(1)
  })

  it('rejects the Send, writes no user action, and keeps the work deferred when the deferred pass cannot start', async () => {
    const { ctx, db, pass } = await setUp(3)
    await deferAPass(ctx, pass, 'cancel')
    // Blocks the pass, whose blockedBy lists it; registered so a start that reads its yieldsTo
    // finds a declaration.
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

    const result = await within(send(ctx, 'I wait.'), 'the refused Send')

    expect(result).toEqual({ outcome: 'rejected', blockedBy: 'translation-retry', converged: true })
    expect(pass.runs).toHaveLength(1)
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(await turnMarkers(db)).toHaveLength(1)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    generationStore.abortRun(blocker.runId, 'aborted')
  })

  it('refuses a Send on a branch held running, starting no run and writing nothing', async () => {
    const { ctx, db, pass } = await setUp(3, BACKLOG)
    await holdTheBranch(db)

    const result = await within(send(ctx, 'I wait.'), 'the refused Send')

    expect(result).toEqual({ outcome: 'rejected', blockedBy: CLASSIFIER_HELD, converged: true })
    expect(pass.runs).toEqual([])
    expect(await db.select().from(pipelineRuns)).toEqual([])
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(generationStore.getTxState().pendingTurns.size).toBe(0)
  })

  // A pass of this process ending with its `running` left on disk while Send reads what it owes.
  it('refuses a Send as held when the branch turns held after its check, starting nothing', async () => {
    const { ctx, db, pass } = await setUp(50, BACKLOG)
    await holdTheBranch(db)
    recordDeferred('pass', IDS)
    const live = registerStoreOnlyRun(PERIODIC_CLASSIFIER_KIND, 'b1')
    let ended = false
    const endsOnFirstRead = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'select' && !ended) {
          ended = true
          generationStore.abortRun(live.runId, 'aborted')
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })

    const result = await within(send({ ...ctx, db: endsOnFirstRead }, 'I wait.'), 'the Send')

    expect(ended).toBe(true)
    expect(result).toEqual({ outcome: 'rejected', blockedBy: CLASSIFIER_HELD, converged: true })
    expect(pass.runs).toEqual([])
    expect(await db.select().from(pipelineRuns)).toEqual([])
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
  })

  // The reader shows the held entry, not a retryable failure: a Retry would only be refused.
  it.each(['fails', 'is cancelled'] as const)(
    'refuses a Send as held when its owed pass %s and its reversal does not commit',
    async (how) => {
      const { ctx, db, pass } = await setUp(3, BACKLOG, { statusLifecycle: true })
      failReversalsOf(pass)

      const sent = send(ctx, 'I wait.')
      const owed = await within(pass.nextHeld(), 'the owed pass')
      if (how === 'fails') owed.finish('threw')
      else await interruptMemoryRuns('b1')
      const result = await within(sent, 'the refused Send')

      expect(result).toEqual({ outcome: 'rejected', blockedBy: CLASSIFIER_HELD, converged: true })
      expect(await isClassifierHeld('b1', ctx)).toBe(true)
      expect(await userActionsReading(db, 'I wait.')).toEqual([])
      expect(await turnMarkers(db)).toEqual([])
      expect(generationStore.getTxState().pendingTurns.size).toBe(0)
    },
  )

  it('runs no pass before a turn when nothing is owed', async () => {
    const { ctx, db, pass } = await setUp(50)

    const result = expectRan(await within(send(ctx, 'I knock.'), 'the turn'))

    expect(result.outcome).toBe('completed')
    expect(pass.runs).toEqual([])
    expect(
      await db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, PER_TURN_KIND)),
    ).toHaveLength(1)
    expect(
      await db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, PERIODIC_CLASSIFIER_KIND)),
    ).toEqual([])
  })
})

// generation-pipeline.md → chainsTo on predecessor: Send runs an owed close before the turn.
describe('Send with a close owed', () => {
  beforeEach(() => {
    resetSingletons()
    vi.stubGlobal('fetch', sseFetch(['A reply.']))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetSingletons()
  })

  it('runs a deferred close before the user action, clearing its record', async () => {
    const { ctx, db, pass, close } = await setUp(50, COUNTED_BACKLOG)
    setThreshold(OWED_AT)
    await setWatermark(db, 3)
    recordDeferred('close', IDS)

    const { result, ran } = await sendThrough(ctx, db, { pass, close }, ['close'])

    expect(result.outcome).toBe('completed')
    await expectWritesBeforeTurn(db, ran, result)
    expect(pass.runs).toEqual([])
    expect(generationStore.getTxState().deferred.get('b1')).toBeUndefined()
    expect(await db.select().from(chapters)).toHaveLength(1)
  })

  it('runs a deferred pass, then the close it chains, before the user action', async () => {
    const { ctx, db, pass, close } = await setUp(50, COUNTED_BACKLOG)
    setThreshold(OWED_AT)
    recordDeferred('pass', IDS)
    recordDeferred('close', IDS)

    const { result, ran } = await sendThrough(ctx, db, { pass, close }, ['pass', 'close'])

    expect(result.outcome).toBe('completed')
    await expectWritesBeforeTurn(db, ran, result)
    expect(generationStore.getTxState().deferred.get('b1')).toBeUndefined()
    expect(await db.select().from(chapters)).toHaveLength(1)
  })

  // As a failed close leaves it: nothing recorded, the region still over the threshold.
  it('runs a close owed with no record before the user action', async () => {
    const { ctx, db, pass, close } = await setUp(50, COUNTED_BACKLOG)
    setThreshold(OWED_AT)
    await setWatermark(db, 3)
    expect(generationStore.getTxState().deferred.size).toBe(0)

    const { result, ran } = await sendThrough(ctx, db, { pass, close }, ['close'])

    expect(result.outcome).toBe('completed')
    await expectWritesBeforeTurn(db, ran, result)
    expect(await db.select().from(chapters)).toHaveLength(1)
  })

  it('clears a close record with no close owed, runs nothing, and lands the turn', async () => {
    const { ctx, db, pass, close } = await setUp(50, COUNTED_BACKLOG)
    await setWatermark(db, 3)
    recordDeferred('close', IDS)

    const result = expectRan(await within(send(ctx, 'I wait.'), 'the turn'))

    expect(result.outcome).toBe('completed')
    expect(generationStore.getTxState().deferred.get('b1')).toBeUndefined()
    expect(close.runs).toEqual([])
    expect(pass.runs).toEqual([])
    expect(await closeMarkers(db)).toEqual([])
    expect(await userActionsReading(db, 'I wait.')).toHaveLength(1)
  })

  it('runs one close before the user action, though the region stays over the threshold', async () => {
    const { ctx, db, pass, close } = await setUp(50, COUNTED_BACKLOG, {}, { leaveOpen: true })
    setThreshold(OWED_AT)
    await setWatermark(db, 3)

    const { result, ran } = await sendThrough(ctx, db, { pass, close }, ['close'])

    // Send's owed work ran one close; the turn's own chain may close again after it.
    expect(close.runs).toHaveLength(1)
    await expectWritesBeforeTurn(db, ran, result)
    await within(cancelStoryRuns('s1', 'b1'), 'ending the chain the turn started')
  })

  it('fails the Send when the close its pass chained fails, writing no user action', async () => {
    const { ctx, db, pass, close, deferrals } = await setUp(50, COUNTED_BACKLOG)
    setThreshold(OWED_AT)

    const sent = send(ctx, 'I wait.')
    const caughtUp = await within(pass.nextHeld(), 'the catch-up pass')
    caughtUp.finish('completed')
    const held = await within(close.nextHeld(), 'the close')
    expect(held.beforeTurn).toBe(true)
    held.finish('failed')
    const result = await within(sent, 'the failed Send')

    expect(result).toEqual({
      runId: expect.any(String),
      actionId: held.actionId,
      outcome: 'failed',
      error: { kind: 'phase-logic', detail: 'stand-in close failed' },
      beforeTurn: true,
      work: 'close',
    })
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(await turnMarkers(db)).toEqual([])
    expect(await db.select().from(chapters)).toEqual([])
    expect(generationStore.getTxState().deferred.size).toBe(0)
    expect(deferrals).toEqual([])
  })

  it('fails the Send on a failed catch-up pass, starting no close', async () => {
    const { ctx, db, pass, close } = await setUp(50, COUNTED_BACKLOG)
    setThreshold(OWED_AT)

    const sent = send(ctx, 'I wait.')
    const held = await within(pass.nextHeld(), 'the catch-up pass')
    held.finish('failed')
    const result = await within(sent, 'the failed Send')

    expect(result).toMatchObject({
      outcome: 'failed',
      actionId: held.actionId,
      beforeTurn: true,
      work: 'pass',
    })
    expect(close.runs).toEqual([])
    expect(await closeMarkers(db)).toEqual([])
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
  })

  it('cancels the whole Send when the close its pass chained is cancelled, deferring it', async () => {
    const { ctx, db, pass, close, deferrals } = await setUp(50, COUNTED_BACKLOG)
    setThreshold(OWED_AT)

    const sent = send(ctx, 'I wait.')
    const caughtUp = await within(pass.nextHeld(), 'the catch-up pass')
    caughtUp.finish('completed')
    const held = await within(close.nextHeld(), 'the close')
    await interruptMemoryRuns('b1')
    const result = await within(sent, 'the cancelled Send')

    expect(result).toMatchObject({
      outcome: 'aborted',
      actionId: held.actionId,
      beforeTurn: true,
      work: 'close',
      // The catch-up pass committed before the close it chained was cancelled.
      committed: true,
    })
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(await db.select().from(chapters)).toEqual([])
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ close: true })
    expect(deferrals).toEqual([
      expect.objectContaining({ kind: CHAPTER_CLOSE_KIND, work: 'close' }),
    ])
  })

  // The close ignored a Cancel landing after its last phase and committed; the Send is still cancelled.
  it('cancels the Send when Cancel lands after its owed close ended its last phase', async () => {
    const { ctx, db, pass, close } = await setUp(50, COUNTED_BACKLOG, {}, { leaveOpen: true })
    setThreshold(OWED_AT)
    await setWatermark(db, 3)

    const sent = send(ctx, 'I wait.')
    const held = await within(close.nextHeld(), "Send's owed close")
    held.finish('completed')
    const interrupted = interruptMemoryRuns('b1')
    const result = await within(sent, 'the cancelled Send')
    await interrupted

    expect(result).toMatchObject({
      outcome: 'aborted',
      actionId: held.actionId,
      beforeTurn: true,
      work: 'close',
      committed: true,
    })
    expect((await markerOf(db, held.actionId))?.outcome).toBe('completed')
    expect(await db.select().from(chapters)).toHaveLength(1)
    expect(pass.runs).toEqual([])
    expect(await userActionsReading(db, 'I wait.')).toEqual([])
    expect(await turnMarkers(db)).toEqual([])
  })

  it('runs a close CTRL-Z reopened again before the next turn', async () => {
    const { ctx, db, pass, close } = await setUp(50, COUNTED_BACKLOG)
    setThreshold(OWED_AT)
    await setWatermark(db, 3)
    const closing = startPipeline(CHAPTER_CLOSE_KIND, ctx)
    const auto = await within(close.nextHeld(), 'the auto close')
    auto.finish('completed')
    expect(expectRan(await closing.origin).outcome).toBe('completed')
    expect(await db.select().from(chapters)).toHaveLength(1)

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await db.select().from(chapters)).toEqual([])

    const { result, ran } = await sendThrough(ctx, db, { pass, close }, ['close'])

    expect(close.runs).toHaveLength(2)
    await expectWritesBeforeTurn(db, ran, result)
    expect(await db.select().from(chapters)).toHaveLength(1)
  })
})
