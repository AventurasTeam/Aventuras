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
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { idleStatus, PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import {
  branches,
  pipelineRuns,
  stories,
  storyEntries,
  type ClassifierStatus,
  type StoryEntry,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  currentStoryStore,
  entitiesStore,
  generationStore,
  hydrateAppSettings,
  type RunState,
} from '@/lib/stores'

import { __resetClassifierEmbedder } from './description-embedder'
import {
  closeOwed,
  isClassifierHeld,
  nextMemoryRun,
  owedPassAtSend,
  passChainsTo,
  passStartedAlone,
  perTurnChainsTo,
  readClassifierStatus,
  unprocessedEntryCount,
} from './memory-chain'
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
  renames: [],
  placements: [],
  standings: [],
  newThreads: [],
  threadStatuses: [],
  knownAwareness: [],
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

function passRun(over: Partial<RunState> = {}): RunState {
  return turnRun({
    runId: 'run_pass',
    kind: PERIODIC_CLASSIFIER_KIND,
    interruptible: 'pass',
    actionId: 'act_pass',
    ...over,
  })
}

// Records interrupted work deferred on b1, as a head reversal or the pill's Cancel does.
function deferOnB1(kind: string, slot: 'pass' | 'close'): void {
  const interrupted = turnRun({ runId: `run_${slot}`, kind, interruptible: slot })
  generationStore.startRun(interrupted)
  expect(generationStore.abortRun(interrupted.runId, 'aborted')).toBe(slot)
}

// Runs `during` as the first select is built: a run starting or ending mid-read of the status.
function onFirstSelect<T extends object>(db: T, during: () => void): T {
  let fired = false
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'select' && !fired) {
        fired = true
        during()
      }
      return Reflect.get(target, prop, receiver) as unknown
    },
  })
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

// Counted rows: one written with no count reads 0 tokens, which no threshold reaches.
async function seedRegion(db: Db, kinds: readonly StoryEntry['kind'][]): Promise<void> {
  for (const [i, kind] of kinds.entries())
    await db.insert(storyEntries).values({
      id: `e${i + 1}`,
      branchId: 'b1',
      position: i + 1,
      kind,
      content: `entry ${i + 1}`,
      contentTokens: 100,
      createdAt: i + 1,
    })
}

type Settings = typeof STORY_SETTINGS

function openWith(over: Partial<Settings>): void {
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition: STORY_DEFINITION,
    settings: { ...STORY_SETTINGS, ...over },
  })
  entitiesStore.hydrate('b1', [])
}

// Opening, action and reply: 300 counted tokens at a threshold of 300, under a cadence never due.
async function owedRegion(db: Db, status: Partial<ClassifierStatus> = {}): Promise<void> {
  await seedRegion(db, ['opening', 'user_action', 'ai_reply'])
  await setStatus(db, status)
  openWith({ classifierCadence: 50, chapterTokenThreshold: 300 })
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
    chainsTo: perTurnChainsTo,
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

    await setStatus(db, { state: 'failed', lastError: 'boom', processedThrough: 4 })

    expect(await readClassifierStatus('b1', ctx)).toEqual({
      ...idleStatus(),
      state: 'failed',
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

  it('names nothing while the status is running, as a crash left it', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 4)
    await setStatus(db, { state: 'running' })
    openStory(1)

    expect(await nextMemoryRun(turnRun(), ctx)).toBeNull()
  })

  // classifier.md → Failure policy: nothing suspends a failed pass; the next due commit runs it.
  it('names a pass for a failed status at the next due commit', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 2)
    await setStatus(db, { state: 'failed', lastError: 'rate limited' })
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

// generation-pipeline.md → chainsTo on predecessor: a pick, or the open region at the threshold.
describe('closeOwed', () => {
  const story = (over: Partial<Settings>) => ({ settings: { ...STORY_SETTINGS, ...over } })

  it('owes a picked close with auto-close off', async () => {
    const { db, ctx } = await makeHarness()
    await seedRegion(db, ['opening'])
    generationStore.setPendingClose('b1', { endEntryId: 'e1' })

    expect(await closeOwed('b1', story({ chapterAutoClose: false }), ctx)).toBe(true)
  })

  it("owes nothing for another branch's pick", async () => {
    const { db, ctx } = await makeHarness()
    await seedRegion(db, ['opening'])
    generationStore.setPendingClose('b2', { endEntryId: 'e1' })

    expect(await closeOwed('b1', story({ chapterAutoClose: false }), ctx)).toBe(false)
  })

  it('owes nothing over the threshold with auto-close off', async () => {
    const { db, ctx } = await makeHarness()
    await seedRegion(db, ['opening', 'user_action', 'ai_reply'])

    expect(
      await closeOwed('b1', story({ chapterAutoClose: false, chapterTokenThreshold: 100 }), ctx),
    ).toBe(false)
  })

  // C10: a chapter ends only on a reply, so an opening alone would fail every Send.
  it.each([
    ['[opening]', ['opening']],
    ['[opening, user_action]', ['opening', 'user_action']],
  ] as const)('owes nothing over the threshold on %s', async (_label, kinds) => {
    const { db, ctx } = await makeHarness()
    await seedRegion(db, kinds)

    expect(await closeOwed('b1', story({ chapterTokenThreshold: 1 }), ctx)).toBe(false)
  })

  it('owes a close at exactly the threshold with a reply, and none a token short of it', async () => {
    const { db, ctx } = await makeHarness()
    await seedRegion(db, ['opening', 'user_action', 'ai_reply'])

    expect(await closeOwed('b1', story({ chapterTokenThreshold: 300 }), ctx)).toBe(true)
    expect(await closeOwed('b1', story({ chapterTokenThreshold: 301 }), ctx)).toBe(false)
  })
})

// chapter-close.md → Phase 0: the passes catch up first, then the close.
describe('nextMemoryRun with a close owed', () => {
  it('names a catch-up pass while entries are unprocessed, though the cadence is not due', async () => {
    const { db, ctx } = await makeHarness()
    await owedRegion(db)

    expect(await nextMemoryRun(turnRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
  })

  it('names the close once no entry is unprocessed', async () => {
    const { db, ctx } = await makeHarness()
    await owedRegion(db, { processedThrough: 3 })

    expect(await nextMemoryRun(turnRun(), ctx)).toBe(CHAPTER_CLOSE_KIND)
  })

  it('names the close a pick owes', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 2)
    await setStatus(db, { processedThrough: 2 })
    openStory(50)
    generationStore.setPendingClose('b1', { endEntryId: 'e2' })

    expect(await nextMemoryRun(turnRun(), ctx)).toBe(CHAPTER_CLOSE_KIND)
  })

  // A close must not build on a held pass's unreversed writes, whatever is left to process.
  it.each([
    ['entries unprocessed', null],
    ['none unprocessed', 3],
  ] as const)('names nothing on a held branch with %s', async (_label, processedThrough) => {
    const { db, ctx } = await makeHarness()
    await owedRegion(db, { state: 'running', processedThrough })

    expect(await nextMemoryRun(turnRun(), ctx)).toBeNull()
  })

  it('reads past the records a Send runs: a deferred pass and a deferred close', async () => {
    const { db, ctx } = await makeHarness()
    await owedRegion(db)
    deferOnB1(PERIODIC_CLASSIFIER_KIND, 'pass')
    deferOnB1(CHAPTER_CLOSE_KIND, 'close')

    expect(await nextMemoryRun(passRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
  })
})

// generation-pipeline.md → chainsTo on predecessor: interrupted work waits for the next Send.
describe('perTurnChainsTo', () => {
  it.each([
    [PERIODIC_CLASSIFIER_KIND, 'pass', { pass: true }],
    [CHAPTER_CLOSE_KIND, 'close', { close: true }],
  ] as const)(
    'chains nothing while the branch holds deferred work (%s)',
    async (kind, slot, recorded) => {
      const { db, ctx } = await makeHarness()
      await seedEntries(db, 2)
      openStory(2)
      deferOnB1(kind, slot)
      expect(generationStore.getTxState().deferred.get('b1')).toEqual(recorded)

      expect(await perTurnChainsTo(turnRun(), ctx)).toBeNull()
      // The guard is per-turn's alone: a Send's chain reads past the record.
      expect(await nextMemoryRun(turnRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
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

    expect(await perTurnChainsTo(turnRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
  })

  it('chains the catch-up pass, then the close, as nextMemoryRun names them', async () => {
    const { db, ctx } = await makeHarness()
    await owedRegion(db)

    expect(await perTurnChainsTo(turnRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
    await setStatus(db, { processedThrough: 3 })
    expect(await perTurnChainsTo(turnRun(), ctx)).toBe(CHAPTER_CLOSE_KIND)
  })
})

// memory/classifier.md → Pipeline framing: passes chain one another only to catch up for a close.
describe('passChainsTo', () => {
  it('chains nothing with no close owed, though the cadence is due', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 4)
    openStory(1)

    expect(await passChainsTo(passRun(), ctx)).toBeNull()
  })

  it('chains a pass holding its own deferred pass on to the next catch-up pass', async () => {
    const { db, ctx } = await makeHarness()
    await owedRegion(db)
    deferOnB1(PERIODIC_CLASSIFIER_KIND, 'pass')

    expect(await passChainsTo(passRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
  })

  it('chains past a deferred close: the catch-up pass, then the close', async () => {
    const { db, ctx } = await makeHarness()
    await owedRegion(db)
    deferOnB1(CHAPTER_CLOSE_KIND, 'close')

    expect(await passChainsTo(passRun(), ctx)).toBe(PERIODIC_CLASSIFIER_KIND)
    await setStatus(db, { processedThrough: 3 })
    expect(await passChainsTo(passRun(), ctx)).toBe(CHAPTER_CLOSE_KIND)
  })

  it('chains nothing after a pass started alone', async () => {
    const { db, ctx } = await makeHarness()
    await owedRegion(db, { processedThrough: 3 })

    expect(await passChainsTo(passRun({ inputs: { alone: true } }), ctx)).toBeNull()
    expect(await passChainsTo(passRun(), ctx)).toBe(CHAPTER_CLOSE_KIND)
  })

  it.each([
    ['open on another branch', () => openStory(50, { storyId: 's1', branchId: 'b2' })],
    ['closed', () => currentStoryStore.clear()],
  ])("chains nothing while the run's story is %s", async (_label, setOpen) => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 2)
    generationStore.setPendingClose('b1', { endEntryId: 'e2' })
    setOpen()

    expect(await passChainsTo(passRun(), ctx)).toBeNull()
  })
})

describe('passStartedAlone', () => {
  it.each([
    ['alone', { alone: true }, true],
    ['no inputs', undefined, false],
    ['inputs without the flag', {}, false],
    ["another kind's inputs", { refreshGuidance: 'shorter' }, false],
  ] as const)('reads %s', (_label, inputs, alone) => {
    expect(passStartedAlone({ inputs })).toBe(alone)
  })
})

describe('isClassifierHeld', () => {
  it('holds a branch persisted running with no pass of this process on it', async () => {
    const { db, ctx } = await makeHarness()
    await setStatus(db, { state: 'running' })

    expect(await isClassifierHeld('b1', ctx)).toBe(true)
  })

  it.each(['idle', 'failed'] as const)(
    'does not hold a branch whose status is %s',
    async (state) => {
      const { db, ctx } = await makeHarness()
      await setStatus(db, { state })

      expect(await isClassifierHeld('b1', ctx)).toBe(false)
    },
  )

  it('reads running under a live pass on the branch as that pass, not a hold', async () => {
    const { db, ctx } = await makeHarness()
    await setStatus(db, { state: 'running' })
    generationStore.startRun(passRun())

    expect(await isClassifierHeld('b1', ctx)).toBe(false)
  })

  it.each([
    ['a pass on another branch', () => passRun({ branchId: 'b2' })],
    ['a turn on the branch', () => turnRun()],
  ])('still holds the branch beside %s', async (_label, live) => {
    const { db, ctx } = await makeHarness()
    await setStatus(db, { state: 'running' })
    generationStore.startRun(live())

    expect(await isClassifierHeld('b1', ctx)).toBe(true)
  })

  it('counts a pass live when the check begins, though it ends before the read returns', async () => {
    const { db, ctx } = await makeHarness()
    await setStatus(db, { state: 'running' })
    const pass = passRun()
    generationStore.startRun(pass)
    const ending = onFirstSelect(ctx.db, () => generationStore.finishRun(pass.runId))

    expect(await isClassifierHeld('b1', { db: ending })).toBe(false)
  })

  it('counts a pass that starts while the status is read', async () => {
    const { db, ctx } = await makeHarness()
    await setStatus(db, { state: 'running' })
    const starting = onFirstSelect(ctx.db, () => generationStore.startRun(passRun()))

    expect(await isClassifierHeld('b1', { db: starting })).toBe(false)
  })
})

// classifier.md → Failure policy: owed when deferred or the cadence is due; a held branch first.
describe('owedPassAtSend', () => {
  it('names a held branch held, ahead of a deferred pass and a due cadence', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 4)
    await setStatus(db, { state: 'running' })
    openStory(1)
    deferOnB1(PERIODIC_CLASSIFIER_KIND, 'pass')

    expect(await owedPassAtSend('b1', ctx)).toBe('held')
  })

  it("owes nothing while the branch's own pass is live, though it persisted running", async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 4)
    await setStatus(db, { state: 'running' })
    openStory(1)
    generationStore.startRun(passRun())

    expect(await owedPassAtSend('b1', ctx)).toBeNull()
  })

  it('owes a deferred pass whatever the cadence', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 1)
    openStory(8)
    deferOnB1(PERIODIC_CLASSIFIER_KIND, 'pass')

    expect(await owedPassAtSend('b1', ctx)).toBe('owed')
  })

  it('owes no pass for a deferred close alone', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 1)
    openStory(8)
    deferOnB1('chapter-close', 'close')

    expect(await owedPassAtSend('b1', ctx)).toBeNull()
  })

  // The restart case: no mark survives one, so the persisted watermark alone must find the pass.
  it('owes a pass when the cadence is due over the persisted watermark, with no mark', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 6)
    await setStatus(db, { processedThrough: 2 })
    expect(generationStore.getTxState().deferred.size).toBe(0)

    openStory(4)
    expect(await owedPassAtSend('b1', ctx)).toBe('owed')
    openStory(5)
    expect(await owedPassAtSend('b1', ctx)).toBeNull()
    expect(generationStore.getTxState().runs.size).toBe(0)
  })

  it('owes a pass for a failed status once the cadence is due', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 2)
    await setStatus(db, { state: 'failed', lastError: 'invalid key' })
    openStory(2)

    expect(await owedPassAtSend('b1', ctx)).toBe('owed')
  })

  it.each([
    ['open on another branch', () => openStory(1, { storyId: 's1', branchId: 'b2' })],
    ['closed', () => currentStoryStore.clear()],
  ])('owes nothing by cadence while the story is %s', async (_label, setOpen) => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 4)
    setOpen()

    expect(await owedPassAtSend('b1', ctx)).toBeNull()
  })

  it('owes a deferred pass on a branch the open story is not on', async () => {
    const { db, ctx } = await makeHarness()
    await seedEntries(db, 4)
    openStory(1, { storyId: 's1', branchId: 'b2' })
    deferOnB1(PERIODIC_CLASSIFIER_KIND, 'pass')

    expect(await owedPassAtSend('b1', ctx)).toBe('owed')
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

  // classifier.md → Failure policy: no attempt counter, no suspension: every due commit runs it.
  it('runs a failing pass at every due commit, never suspending it, and Run now recovers it', async () => {
    const { ctx } = await makeHarness()
    await hydrateAppSettings(async () => WORKING_CONFIG)
    openStory(2)
    defineTurn()
    ensurePeriodicClassifierPipelineRegistered()
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'failed',
      recoverable: [],
      error: { tier: 'provider', reason: 'unknown', detail: 'rate limited' },
    })

    const states: ClassifierStatus['state'][] = []
    for (let turn = 0; turn < 5; turn++) {
      expectRan(await runPipeline(PER_TURN_KIND, ctx))
      states.push((await readClassifierStatus('b1', ctx)).state)
    }

    expect(states).toEqual(['failed', 'failed', 'failed', 'failed', 'failed'])
    expect(generateStructured).toHaveBeenCalledTimes(5)
    expect(await readClassifierStatus('b1', ctx)).toMatchObject({
      lastError: 'rate limited',
      processedThrough: null,
    })

    vi.mocked(generateStructured).mockResolvedValue({
      status: 'ok',
      recoverable: [],
      value: EMPTY_REPLY,
    })
    expect(
      await runClassifierNow('b1', { db: ctx.db, runInTransaction: ctx.runInTransaction }),
    ).toMatchObject({ outcome: 'completed' })
    expect(await readClassifierStatus('b1', ctx)).toMatchObject({
      state: 'idle',
      lastError: null,
      processedThrough: 10,
    })

    expectRan(await runPipeline(PER_TURN_KIND, ctx))
    expect(generateStructured).toHaveBeenCalledTimes(7)
  })
})
