import type { AssistantModelMessage, ToolCallPart } from 'ai'
import { and, asc, desc, eq, isNotNull, lte } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startManualClose } from '@/lib/actions/chapters/start-manual-close'
import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import { loadOpenStory } from '@/lib/actions/stories/operational'
import { shownCounts } from '@/lib/actions/story-entries/__tests__/shown-counts'
import { rollbackToEntry } from '@/lib/actions/story-entries/operational'
import { redoLastAction, undoLastAction } from '@/lib/actions/story-entries/undo'
import type { GroupOutcome, PipelineAction } from '@/lib/actions/types'
import type {
  GenerateStructuredResult,
  generateStructured,
  generateToolStep,
  ToolStep,
  ToolStepCall,
  ToolStepResult,
} from '@/lib/ai'
import { cutChapterParts } from '@/lib/chapters'
import {
  chapters,
  characterRelationships,
  deltas,
  emptyEntityState,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  storyEntries,
  threads,
  type Delta,
  type EntityState,
} from '@/lib/db'
import { configureDeltaActionPort, pipelineEventBus, type TxResult } from '@/lib/pipeline'
import { interruptMemoryRuns } from '@/lib/stores'

import { standInSlots, standInTool } from './close-stand-in'
import { expectRan, realDeltaActionPort, resetSingletons } from './harness'
import {
  metadataReplyResult,
  openCloseFixture,
  twoPartWindow,
  type CloseFixture,
} from '../definitions/__tests__/close-fixture'
import { chapterPartSummarySchema } from '../definitions/chapter-metadata-schema'
import { identityTask } from '../definitions/close-agent/identity'
import { lifecycleTask } from '../definitions/close-agent/lifecycle'
import { loreTask } from '../definitions/close-agent/lore'
import {
  __setCloseAgentSlots,
  PRODUCTION_CLOSE_SLOTS,
  type CloseAgentSlots,
} from '../definitions/close-agent/slots'
import { threadsTask } from '../definitions/close-agent/threads'
import { assertReplaySafe } from '../definitions/close-agent/tool'
import { upkeepTask } from '../definitions/close-agent/upkeep'

const { generateStructuredMock, generateToolStepMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
  generateToolStepMock: vi.fn<typeof generateToolStep>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}))

beforeEach(() => {
  resetSingletons()
  generateStructuredMock.mockReset()
  generateStructuredMock.mockResolvedValue(metadataReplyResult())
  generateToolStepMock.mockReset()
})

afterEach(() => {
  __setCloseAgentSlots(undefined)
  resetSingletons()
  vi.restoreAllMocks()
})

// The third of six replies (position 7): turns lie on both sides of the close.
const END_REPLY = 2

const CHARACTER_ID = 'char_5b0d2c1e-7f3a-4e8b-9c6d-2a1f0e9b8c7d'

// t3 is position 3, before E: a group anchored on the cited turn would survive the rollback to E.
const STAND_IN_INPUT = {
  id: 'c1',
  description: 'The Harrow ferryman, who poled Wren across the river at night for a courier price.',
  title: 'The Harrow ferry',
  body: 'Old Tobin runs the ferry at Harrow when he chooses to, and the Syndicate taxes every crossing.',
  turns: ['t3'],
  why: 'Tobin is the ferryman Wren finds at the landing.',
}

type ScriptedStep = { calls: readonly Omit<ToolStepCall, 'toolCallId'>[] }

const USAGE: ToolStep['usage'] = {
  inputTokens: 1_000,
  inputTokenDetails: { noCacheTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 50,
  outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
  totalTokens: 1_050,
}

const DONE = 'Nothing more to write.'

function stepResult(step: ScriptedStep, n: number): ToolStepResult {
  const calls: ToolStepCall[] = step.calls.map((call, i) => ({
    ...call,
    toolCallId: `call_${n}_${i + 1}`,
  }))
  const message: AssistantModelMessage = {
    role: 'assistant',
    content:
      calls.length === 0
        ? [{ type: 'text', text: DONE }]
        : calls.map((call): ToolCallPart => ({ type: 'tool-call', ...call })),
  }
  return {
    status: 'ok',
    step: {
      calls,
      invalidCalls: [],
      responseMessages: [message],
      text: calls.length === 0 ? DONE : '',
      finishReason: calls.length === 0 ? 'stop' : 'tool-calls',
      usage: USAGE,
    },
    recoverable: [],
  }
}

// Every step past the script replies with no tool call, which ends the task.
function script(steps: readonly ScriptedStep[]): void {
  let sent = 0
  generateToolStepMock.mockImplementation(async () => {
    sent += 1
    return stepResult(steps[sent - 1] ?? { calls: [] }, sent)
  })
}

const WORLD_TABLES = [
  'chapters',
  'entities',
  'lore',
  'threads',
  'happenings',
  'happening_involvements',
  'happening_awareness',
  'character_relationships',
] as const
type WorldTable = (typeof WORLD_TABLES)[number]

const isWorldTable = (table: string): table is WorldTable =>
  (WORLD_TABLES as readonly string[]).includes(table)

/** Every table a close tool writes, keyed by delta `target_table`, and the entries a chapter stamps. */
type WorldState = {
  rows: Record<WorldTable, readonly { id: string }[]>
  stamped: readonly { id: string; chapterId: string | null }[]
}

async function worldState(fx: CloseFixture): Promise<WorldState> {
  const { db } = fx.ctx
  const b = fx.branchId
  return {
    rows: {
      chapters: await db
        .select()
        .from(chapters)
        .where(eq(chapters.branchId, b))
        .orderBy(asc(chapters.id)),
      entities: await db
        .select()
        .from(entities)
        .where(eq(entities.branchId, b))
        .orderBy(asc(entities.id)),
      lore: await db.select().from(lore).where(eq(lore.branchId, b)).orderBy(asc(lore.id)),
      threads: await db
        .select()
        .from(threads)
        .where(eq(threads.branchId, b))
        .orderBy(asc(threads.id)),
      happenings: await db
        .select()
        .from(happenings)
        .where(eq(happenings.branchId, b))
        .orderBy(asc(happenings.id)),
      happening_involvements: await db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, b))
        .orderBy(asc(happeningInvolvements.id)),
      happening_awareness: await db
        .select()
        .from(happeningAwareness)
        .where(eq(happeningAwareness.branchId, b))
        .orderBy(asc(happeningAwareness.id)),
      character_relationships: await db
        .select()
        .from(characterRelationships)
        .where(eq(characterRelationships.branchId, b))
        .orderBy(asc(characterRelationships.id)),
    },
    stamped: await db
      .select({ id: storyEntries.id, chapterId: storyEntries.chapterId })
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, b), isNotNull(storyEntries.chapterId)))
      .orderBy(asc(storyEntries.position)),
  }
}

async function branchLog(fx: CloseFixture): Promise<Delta[]> {
  return (await fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.branchId, fx.branchId))
    .orderBy(asc(deltas.logPosition))) as Delta[]
}

async function deltasOf(fx: CloseFixture, actionId: string): Promise<Delta[]> {
  return (await fx.ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, fx.branchId), eq(deltas.actionId, actionId)))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

type SeedEntity = {
  id: string
  kind: 'character' | 'location' | 'item' | 'faction'
  name: string
  description: string
  status: 'active' | 'retired'
  state?: EntityState
}

const TOBIN: SeedEntity = {
  id: CHARACTER_ID,
  kind: 'character',
  name: 'Tobin',
  description: 'The ferryman at Harrow.',
  status: 'active',
}

// A pass's create anchored on the first reply: both rollbacks below spare it.
async function seedEntity(fx: CloseFixture, seed: SeedEntity): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: {
          entry: {
            ...seed,
            branchId: fx.branchId,
            injectionMode: 'auto',
            createdAt: 1_767_225_700_000,
            updatedAt: 1_767_225_700_000,
          },
        },
      },
      actionId: `act_close_seed_${seed.name.toLowerCase()}`,
      branchId: fx.branchId,
      entryId: fx.replyIds[0],
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`round trip: seed refused: ${result.reason}`)
}

// A later turn's create: anchored on the fourth reply (position 9, past E) under that turn's action.
async function seedLaterEntity(fx: CloseFixture, seed: SeedEntity): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'per_turn_classifier',
        payload: {
          entry: {
            ...seed,
            branchId: fx.branchId,
            injectionMode: 'auto',
            createdAt: 1_767_225_800_000,
            updatedAt: 1_767_225_800_000,
          },
        },
      },
      actionId: 'act_close_turn_4',
      branchId: fx.branchId,
      entryId: fx.replyIds[3]!,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`round trip: later seed refused: ${result.reason}`)
}

const SYNDICATE: SeedEntity = {
  id: 'fact_3c9e1a5d-7b42-4f08-9d6e-1a2b3c4d5e6f',
  kind: 'faction',
  name: 'The Syndicate',
  description: 'The toll-takers who hold the far bank.',
  status: 'active',
  state: { standing: 'Taxes the ferry, the road and the bread since the spring.' },
}

type SeedThread = { id: string; title: string; description: string; createdAt: number }

// A before B by creation, so Threads shows A as th1 and B as th2.
const THREAD_A: SeedThread = {
  id: 'thr_7a1c2e3f-4b5d-4c6e-8f70-9a1b2c3d4e5f',
  title: 'The letter for Low Ashby',
  description: 'Wren carries a sealed letter to the reeve of Low Ashby.',
  createdAt: 1_767_225_700_100,
}

const THREAD_B: SeedThread = {
  id: 'thr_8b2d3f40-5c6e-4d7f-9a81-0b2c3d4e5f60',
  title: 'The sealed letter',
  description: 'The courier seal must reach Low Ashby unbroken.',
  createdAt: 1_767_225_700_200,
}

async function seedPassWrite(
  fx: CloseFixture,
  actionId: string,
  action: PipelineAction,
): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId, branchId: fx.branchId, entryId: fx.replyIds[0] },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`round trip: seed refused: ${result.reason}`)
}

// A pass's active thread with its trigger ref, anchored as seedEntity's create is.
async function seedThread(fx: CloseFixture, seed: SeedThread): Promise<void> {
  await seedPassWrite(fx, `act_close_seed_${seed.id}`, {
    kind: 'createThread',
    source: 'periodic_classifier',
    payload: {
      entry: {
        ...seed,
        branchId: fx.branchId,
        status: 'active',
        injectionMode: 'auto',
        triggeredAtEntryId: fx.replyIds[0],
        updatedAt: seed.createdAt,
      },
    },
  })
}

// Identity starts from the chapter's scene characters; no action writes an older entry's scene.
async function putInScene(
  fx: CloseFixture,
  entryId: string,
  ids: readonly string[],
): Promise<void> {
  const [entry] = await fx.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, entryId)))
  const metadata = defined(entry?.metadata ?? undefined, `no metadata on ${entryId}`)
  await fx.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...metadata, sceneEntities: [...ids] } })
    .where(and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, entryId)))
  const opened = await loadOpenStory(fx.branchId, fx.ctx)
  if (opened.status !== 'ok') throw new Error(`round trip: story did not reopen: ${opened.status}`)
}

/**
 * Tobin in Tobin's reply's scene and in the Syndicate; A and B active pass threads. No merge rule
 * but the one a case reaches can refuse.
 */
async function seedWorld(fx: CloseFixture): Promise<void> {
  await seedEntity(fx, SYNDICATE)
  await seedPassWrite(fx, 'act_close_seed_membership', {
    kind: 'updateEntity',
    source: 'periodic_classifier',
    payload: {
      branchId: fx.branchId,
      id: TOBIN.id,
      patch: { state: { ...emptyEntityState('character'), faction_id: SYNDICATE.id } },
    },
  })
  await seedThread(fx, THREAD_A)
  await seedThread(fx, THREAD_B)
  await putInScene(fx, fx.replyIds[1], [TOBIN.id])
}

type CloseHarness = {
  readonly fx: CloseFixture
  /** E: the case's close ends on the third reply of six. */
  readonly endEntryId: string
  /** The state before the close ran. */
  readonly before: WorldState
  /** The branch's whole delta log before the close ran: other actions' deltas only. */
  readonly beforeLog: readonly Delta[]
  /** Runs the close to completion; a case must land at least one tool group. */
  close: () => Promise<void>
  /** Starts the close and calls `act` once its first tool group has landed; resolves with the run. */
  closeActingOnToolGroup: (act: () => void) => Promise<TxResult>
  /** The group `act` ran on, if it ran. */
  actedOn: () => ToolGroup | undefined
  /** The close's action, once it started. */
  actionId: () => string
  /** The state and the close's own log as the close completed. */
  closed: () => { state: WorldState; log: Delta[] }
  /** Rolls the branch back to `targetId`, which goes with every entry after it. */
  rollBack: (targetId: string) => Promise<void>
  /** The entry a rollback took the branch back to, if one ran. */
  rolledBackTo: () => string | undefined
}

type ToolGroup = { kinds: readonly PipelineAction['kind'][]; landed: boolean }

const landedAny = (outcome: GroupOutcome | undefined): boolean =>
  outcome?.status === 'ok' && outcome.outcomes.some((one) => one.status === 'landed')

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`round trip: ${what}`)
  return value
}

async function openHarness(c: RoundTripCase): Promise<CloseHarness> {
  const fx = await openCloseFixture(
    c.partWindow === undefined ? undefined : { loreWindow: c.partWindow },
  )
  await seedEntity(fx, TOBIN)
  await c.seed?.(fx)
  if (c.partWindow !== undefined) {
    await expectCutBeforeEnd(fx, c.partWindow)
    answerPartCalls()
  }
  __setCloseAgentSlots(c.slots())
  script(c.steps)
  // The bus hears every group the orchestrator dispatched, refused or not; the port has its outcome.
  let lastOutcome: GroupOutcome | undefined
  configureDeltaActionPort({
    ...realDeltaActionPort(),
    applyDeltaActionGroupWithOutcomes: async (actions, args, ctx) => {
      lastOutcome = await applyDeltaActionGroupWithOutcomes(actions, args, ctx)
      return lastOutcome
    },
  })
  const toolGroups: ToolGroup[] = []
  let onToolGroup: (() => void) | undefined
  let actedOn: ToolGroup | undefined
  // The metadata group is the one with the create.
  pipelineEventBus.subscribe('delta_group_emitted', (event) => {
    const group: ToolGroup = {
      kinds: event.actions.map((a) => a.kind),
      landed: landedAny(lastOutcome),
    }
    if (group.kinds.includes('createChapter')) return
    toolGroups.push(group)
    const act = onToolGroup
    if (act === undefined || !group.landed) return
    onToolGroup = undefined
    actedOn = group
    act()
  })
  const endEntryId = fx.replyIds[END_REPLY]
  const before = await worldState(fx)
  const beforeLog = await branchLog(fx)
  let actionId: string | undefined
  let closed: { state: WorldState; log: Delta[] } | undefined
  let rolledBackTo: string | undefined
  const start = async (): Promise<TxResult> => {
    const tx = expectRan(await startManualClose(fx.branchId, endEntryId, fx.ctx))
    actionId = tx.actionId
    return tx
  }
  return {
    fx,
    endEntryId,
    before,
    beforeLog,
    close: async () => {
      const tx = await start()
      expect(tx).toMatchObject({ outcome: 'completed' })
      expect(
        toolGroups.some((group) => group.landed),
        'the case landed nothing',
      ).toBe(true)
      const log = await deltasOf(fx, tx.actionId)
      if (c.merge)
        expect(
          log.some((d) => d.op === 'delete'),
          'a merge case deletes the row it absorbs',
        ).toBe(true)
      // A table the snapshot misses would let a reversal leave rows behind unseen.
      const unlisted = new Set(
        log.map((d) => d.targetTable).filter((t) => t !== 'story_entries' && !isWorldTable(t)),
      )
      expect([...unlisted], 'close deltas on tables the snapshot misses').toEqual([])
      closed = { state: await worldState(fx), log }
    },
    closeActingOnToolGroup: (act) => {
      onToolGroup = act
      return start()
    },
    actedOn: () => actedOn,
    actionId: () => defined(actionId, 'the close has not started'),
    closed: () => defined(closed, 'the close has not completed'),
    rollBack: async (targetId) => {
      const counts = await shownCounts(fx.branchId, targetId, fx.ctx)
      expect(
        await rollbackToEntry(fx.branchId, targetId, fx.ctx, { expectedCounts: counts }),
      ).toEqual({ status: 'ok', counts })
      rolledBackTo = targetId
    },
    rolledBackTo: () => rolledBackTo,
  }
}

async function undoClose(h: CloseHarness): Promise<void> {
  // C9: a hold redo can't restore refuses as `integrity`, with `held-in-redo` in its reason.
  expect(await undoLastAction(h.fx.branchId, h.fx.ctx)).toEqual({ status: 'ok' })
  expect(await worldState(h.fx), 'the world after CTRL-Z').toEqual(h.before)
}

// A rollback takes the entries from its target on and every delta written for them. A turn's create
// names its entry; the pass's create is anchored on one.
function keptByRollback(h: CloseHarness, targetId: string): Delta[] {
  const positions = new Map(h.fx.entries.map((e) => [e.id, e.position]))
  const positionOf = (id: string | null): number =>
    defined(id === null ? undefined : positions.get(id), `no fixture entry ${id}`)
  const cut = positionOf(targetId)
  return h.beforeLog.filter(
    (d) => positionOf(d.targetTable === 'story_entries' ? d.targetId : d.entryId) < cut,
  )
}

type RoundTripCase = {
  name: string
  slots: () => CloseAgentSlots
  /** Rows the case's tools need, written before the state the arms compare against. */
  seed?: (fx: CloseFixture) => Promise<void>
  steps: ScriptedStep[]
  merge: boolean
  /** lore-mgmt's window for this case, so the fixture's range cuts into parts. */
  partWindow?: number
  /** An arm's own expected world, in place of the shared before/closed comparison. */
  armExpect?: Partial<Record<string, (h: CloseHarness) => Promise<void>>>
}

type RoundTripArm = {
  name: string
  run: (h: CloseHarness) => Promise<void>
  expect: 'before-close' | 'after-close'
}

const STAND_IN_CASE: RoundTripCase = {
  name: 'stand_in_write',
  slots: standInSlots,
  steps: [{ calls: [{ toolName: 'stand_in_write', input: STAND_IN_INPUT }] }],
  merge: false,
}

const identitySlots = (): CloseAgentSlots => ({
  before: [],
  perPart: [{ kind: 'task', def: identityTask }],
  after: [],
})

const threadsSlots = (): CloseAgentSlots => ({
  before: [],
  perPart: [{ kind: 'task', def: threadsTask }],
  after: [],
})

const WHY = 'The innkeeper says the ferry runs when Tobin says it runs.'

const UPDATE_CHARACTER = {
  id: 'c1',
  traits: ['stubborn', 'drinks from noon'],
  description: 'The Harrow ferryman, who runs the night crossing only when he chooses.',
  turns: ['t5'],
  why: WHY,
}

const UPDATE_FACTION = {
  id: 'f1',
  agenda: ['tax every crossing', 'read every letter'],
  standing: 'Holds the ferry town of Harrow.',
  turns: ['t5'],
  why: WHY,
}

const UPDATE_THREAD = {
  id: 'th1',
  description: 'Wren reaches Harrow with the sealed letter for the reeve of Low Ashby.',
  status: 'resolved',
  turns: ['t5'],
  why: WHY,
}

const UPDATE_KEPT = {
  id: 'th1',
  description: 'Wren keeps the sealed letter close while she looks for a night crossing.',
  turns: ['t5'],
  why: WHY,
}

const UPDATE_ABSORBED = {
  id: 'th2',
  description: 'The seal must reach Low Ashby unbroken, and the toll guards read letters.',
  turns: ['t5'],
  why: WHY,
}

const MERGE = {
  keep: 'th1',
  absorb: ['th2'],
  description: 'Wren carries a sealed courier letter to the reeve of Low Ashby, to deliver unread.',
  turns: ['t5'],
  why: 'Both threads are the one sealed letter in her satchel.',
}

/** The case that reaches merge_threads' already-wrote check: B was written by this close. */
const ABSORBED_WROTE_CASE: RoundTripCase = {
  name: 'update_thread on the absorbed row, then merge_threads',
  slots: threadsSlots,
  seed: seedWorld,
  steps: [
    { calls: [{ toolName: 'update_thread', input: UPDATE_ABSORBED }] },
    { calls: [{ toolName: 'merge_threads', input: MERGE }] },
  ],
  // The merge is refused, so the log holds no delete.
  merge: false,
}

const loreSlots = (): CloseAgentSlots => ({
  before: [],
  perPart: [{ kind: 'task', def: loreTask }],
  after: [],
})

const upkeepSlots = (): CloseAgentSlots => ({
  before: [],
  perPart: [{ kind: 'task', def: upkeepTask }],
  after: [],
})

const lifecycleSlots = (): CloseAgentSlots => ({
  before: [],
  perPart: [{ kind: 'task', def: lifecycleTask }],
  after: [],
})

// E is position 7: part 1 holds t1-t5 and part 2 E's turn, t6-t7, so part-2 calls cite t7.
const PART_WINDOW = twoPartWindow(7)

const PART_SUMMARY: GenerateStructuredResult<{ summary: string }> = {
  status: 'ok',
  value: { summary: 'Wren reaches Harrow and finds the night ferry.' },
  recoverable: [],
}

// A part call answers the part shape; the merge, and a one-part close, the metadata.
function answerPartCalls(): void {
  generateStructuredMock.mockImplementation(
    async (_target, _prompt, schema) =>
      ((schema as unknown) === chapterPartSummarySchema
        ? PART_SUMMARY
        : metadataReplyResult()) as never,
  )
}

// The case's window comes from the fixture's prose; the cut must agree with the counts it stored.
async function expectCutBeforeEnd(fx: CloseFixture, window: number): Promise<void> {
  const endIndex = fx.entries.findIndex((entry) => entry.id === fx.replyIds[END_REPLY])
  const stored = await fx.ctx.db
    .select({ id: storyEntries.id, kind: storyEntries.kind, tokens: storyEntries.contentTokens })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, fx.branchId),
        lte(storyEntries.position, fx.entries[endIndex]!.position),
      ),
    )
    .orderBy(asc(storyEntries.position))
  const cuts = cutChapterParts(
    stored.map(({ id, kind, tokens }) => ({ id, kind, tokens: tokens ?? 0 })),
    window,
  )
  // E's turn (the player's turn before it) goes with E: a part never ends on a player's turn.
  expect(fx.entries[endIndex - 1]!.kind).toBe('user_action')
  expect(
    cuts.map(({ part, startEntryId, endEntryId }) => [part, startEntryId, endEntryId]),
    "the case window cuts the chapter just before E's turn",
  ).toEqual([
    [1, fx.entries[0]!.id, fx.entries[endIndex - 2]!.id],
    [2, fx.entries[endIndex - 1]!.id, fx.entries[endIndex]!.id],
  ])
}

function withoutEntity(state: WorldState, id: string): WorldState {
  return {
    ...state,
    rows: { ...state.rows, entities: state.rows.entities.filter((row) => row.id !== id) },
  }
}

// Named in the opening ("the ferry town of Harrow"), unplaced: Upkeep shows it as l1.
const HARROW: SeedEntity = {
  id: 'loc_1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  kind: 'location',
  name: 'Harrow',
  description: 'A ferry town low on the river.',
  status: 'active',
  state: { parent_location_id: null, unplaced: true },
}

// Named nowhere in the chapter: reached by search_world, so it is l2.
const RIVER_COUNTRY: SeedEntity = {
  id: 'loc_2e3f4051-6b7c-4d8e-9fa0-1b2c3d4e5f60',
  kind: 'location',
  name: 'The River Country',
  description: 'The flat country the river drains, under a new toll.',
  status: 'active',
  state: { parent_location_id: null },
}

// Named in the opening ("the letter in her satchel"): Upkeep shows it as i1.
const SATCHEL: SeedEntity = {
  id: 'item_3f405162-7c8d-4e9f-a0b1-2c3d4e5f6071',
  kind: 'item',
  name: 'Satchel',
  description: 'A courier satchel.',
  status: 'active',
}

// Named by the sixth entry ("look for the ferryman"); a later turn creates it.
const FERRYMAN: SeedEntity = {
  id: 'char_40516273-8d9e-4fa0-b1c2-3d4e5f607182',
  kind: 'character',
  name: 'The Ferryman',
  description: 'The ferryman the far bank talks of.',
  status: 'active',
}

const CROSSING_HAPPENING = {
  id: 'hap_51627384-9eaf-40b1-82c3-4e5f60718293',
  title: 'Tobin names a courier price',
  description: 'The ferryman asks twice the boat for a night crossing.',
}

const TOLL_LORE = {
  id: 'lore_62738495-afb0-41c2-93d4-5f6071829304',
  title: 'The Harrow toll',
  body: 'The Syndicate takes a toll on every crossing at Harrow.',
  keywords: ['toll'],
}

async function seedPlaces(fx: CloseFixture): Promise<void> {
  await seedEntity(fx, HARROW)
  await seedEntity(fx, RIVER_COUNTRY)
}

async function seedSatchel(fx: CloseFixture): Promise<void> {
  await seedEntity(fx, SATCHEL)
}

// A pass's keyword on Tobin, which the keyword-author walk lets a close remove.
async function seedTobinKeyword(fx: CloseFixture): Promise<void> {
  await seedPassWrite(fx, 'act_close_seed_keywords', {
    kind: 'updateEntity',
    source: 'periodic_classifier',
    payload: { branchId: fx.branchId, id: TOBIN.id, patch: { keywords: ['the old man'] } },
  })
}

// A happening of the chapter's second reply, not yet common knowledge: Upkeep shows it as hp1.
async function seedCrossing(fx: CloseFixture): Promise<void> {
  await seedPassWrite(fx, 'act_close_seed_happening', {
    kind: 'createHappening',
    source: 'periodic_classifier',
    payload: {
      entry: {
        ...CROSSING_HAPPENING,
        branchId: fx.branchId,
        occurredAtEntryId: fx.replyIds[1]!,
        commonKnowledge: 0,
        createdAt: 1_767_225_700_400,
        updatedAt: 1_767_225_700_400,
      },
    },
  })
}

// An earlier lore agent's row: its keyword is a machine's, so a close may remove it.
async function seedTollLore(fx: CloseFixture): Promise<void> {
  await seedPassWrite(fx, 'act_close_seed_lore', {
    kind: 'createLore',
    source: 'lore_agent',
    payload: {
      entry: {
        ...TOLL_LORE,
        branchId: fx.branchId,
        injectionMode: 'auto',
        createdAt: 1_767_225_700_300,
        updatedAt: 1_767_225_700_300,
      },
    },
  })
}

async function seedLaterFerryman(fx: CloseFixture): Promise<void> {
  await seedLaterEntity(fx, FERRYMAN)
}

const LORE_CREATE = {
  title: 'The night ferry',
  body: 'The Harrow ferry crosses at night only when old Tobin chooses, for a price a courier pays.',
  keywords: ['night ferry'],
  turns: ['t5'],
  why: 'The innkeeper says the ferry runs at night when Tobin says it runs.',
}

// lo1: the row part 1 created, which part 2's Lore start lists by title.
const LORE_UPDATE_CREATED = {
  id: 'lo1',
  body: 'The Harrow ferry crosses at night only when old Tobin chooses, for a price a courier pays; he waits for fares on his barrel at the landing.',
  turns: ['t7'],
  why: 'Tobin sits waiting on an upturned barrel at the landing.',
}

const LORE_KEYWORDS = {
  id: 'lo1',
  category: 'Law',
  keywords: { add: ['ferry toll'], remove: ['toll'] },
  turns: ['t5'],
  why: 'The innkeeper names the ferry price as the law of the crossing.',
}

const UPDATE_PLACE = {
  id: 'l1',
  condition: 'Its lamps are lit against the dusk.',
  parent: 'l2',
  turns: ['t1'],
  why: 'The opening finds Harrow low on the river, its lamps lit.',
}

const UPDATE_ITEM = {
  id: 'i1',
  condition: 'Heavy with the letter, three days wet.',
  description: 'A courier satchel of oiled leather.',
  turns: ['t1'],
  why: 'The letter in her satchel has not grown lighter in three days of rain.',
}

const SET_KEYWORDS = {
  id: 'c1',
  add: ['old tobin'],
  remove: ['the old man'],
  turns: ['t5'],
  why: 'The innkeeper calls him old Tobin.',
}

const MARK_COMMON = {
  id: 'hp1',
  turns: ['t5'],
  why: 'The innkeeper speaks of the ferry price as all of Harrow knows it.',
}

const RETIRE = {
  id: 'c1',
  turns: ['t7'],
  why: 'Tobin goes into the black water off the landing and does not come up.',
}

// Lifecycle shows its rows by name: "The Ferryman" (c1) sorts before "Tobin" (c2).
const FLAG_DUPLICATE = {
  id: 'c2',
  partner: 'c1',
  turns: ['t7'],
  why: 'The ferryman Wren goes looking for is Tobin, on his barrel at the landing.',
}

const LORE_ACROSS_PARTS_CASE: RoundTripCase = {
  name: 'create_lore in part 1, then update_lore of that row in part 2',
  slots: loreSlots,
  partWindow: PART_WINDOW,
  steps: [
    { calls: [{ toolName: 'create_lore', input: LORE_CREATE }] },
    // Ends part 1's Lore; the next step is part 2's.
    { calls: [] },
    { calls: [{ toolName: 'read_row', input: { id: 'lo1' } }] },
    { calls: [{ toolName: 'update_lore', input: LORE_UPDATE_CREATED }] },
  ],
  merge: false,
}

const LORE_KEYWORDS_CASE: RoundTripCase = {
  name: "update_lore's keywords beside a text field",
  slots: loreSlots,
  seed: seedTollLore,
  steps: [
    { calls: [{ toolName: 'read_row', input: { id: 'lo1' } }] },
    { calls: [{ toolName: 'update_lore', input: LORE_KEYWORDS }] },
  ],
  merge: false,
}

const UPDATE_PLACE_CASE: RoundTripCase = {
  name: 'update_place writing condition and a parent',
  slots: upkeepSlots,
  seed: seedPlaces,
  steps: [
    { calls: [{ toolName: 'search_world', input: { query: 'The River Country' } }] },
    { calls: [{ toolName: 'read_row', input: { id: 'l2' } }] },
    { calls: [{ toolName: 'update_place', input: UPDATE_PLACE }] },
  ],
  merge: false,
}

const UPDATE_ITEM_CASE: RoundTripCase = {
  name: 'update_item',
  slots: upkeepSlots,
  seed: seedSatchel,
  steps: [{ calls: [{ toolName: 'update_item', input: UPDATE_ITEM }] }],
  merge: false,
}

const SET_KEYWORDS_CASE: RoundTripCase = {
  name: 'set_keywords adding and removing',
  slots: upkeepSlots,
  seed: seedTobinKeyword,
  steps: [{ calls: [{ toolName: 'set_keywords', input: SET_KEYWORDS }] }],
  merge: false,
}

const MARK_COMMON_CASE: RoundTripCase = {
  name: 'mark_common_knowledge',
  slots: upkeepSlots,
  seed: seedCrossing,
  steps: [{ calls: [{ toolName: 'mark_common_knowledge', input: MARK_COMMON }] }],
  merge: false,
}

const RETIRE_CASE: RoundTripCase = {
  name: 'retire_entity',
  slots: lifecycleSlots,
  steps: [{ calls: [{ toolName: 'retire_entity', input: RETIRE }] }],
  merge: false,
}

const FLAG_CASE: RoundTripCase = {
  name: 'flag_duplicate whose partner a later turn created',
  slots: lifecycleSlots,
  seed: seedLaterFerryman,
  steps: [{ calls: [{ toolName: 'flag_duplicate', input: FLAG_DUPLICATE }] }],
  merge: false,
  // Both rollbacks take the turn that created the partner; the flag stays on Tobin, dormant.
  armExpect: {
    'a rollback past E': async (h) => {
      expect(await worldState(h.fx)).toEqual(withoutEntity(h.closed().state, FERRYMAN.id))
      const [tobin] = await h.fx.ctx.db
        .select()
        .from(entities)
        .where(and(eq(entities.branchId, h.fx.branchId), eq(entities.id, TOBIN.id)))
      expect(tobin).toMatchObject({
        nameCollisionFlag: 1,
        nameCollisionPartnerId: FERRYMAN.id,
        nameCollisionReason: 'duplicate',
      })
    },
    'a rollback to E': async (h) => {
      expect(await worldState(h.fx)).toEqual(withoutEntity(h.before, FERRYMAN.id))
    },
  },
}

const THREADS_ACROSS_PARTS_CASE: RoundTripCase = {
  name: 'update_thread in part 1, then merge_threads absorbing that row in part 2',
  slots: threadsSlots,
  seed: seedWorld,
  partWindow: PART_WINDOW,
  steps: [
    { calls: [{ toolName: 'update_thread', input: UPDATE_ABSORBED }] },
    // Ends part 1's Threads; the next step is part 2's.
    { calls: [] },
    { calls: [{ toolName: 'merge_threads', input: { ...MERGE, turns: ['t7'] } }] },
  ],
  // The merge is refused, so the log holds no delete.
  merge: false,
}

/** C9: every tool's landed group joins this table. */
const CASES: readonly RoundTripCase[] = [
  STAND_IN_CASE,
  {
    name: 'update_character',
    slots: identitySlots,
    seed: seedWorld,
    steps: [{ calls: [{ toolName: 'update_character', input: UPDATE_CHARACTER }] }],
    merge: false,
  },
  {
    name: 'update_faction',
    slots: identitySlots,
    seed: seedWorld,
    steps: [{ calls: [{ toolName: 'update_faction', input: UPDATE_FACTION }] }],
    merge: false,
  },
  {
    name: 'update_thread',
    slots: threadsSlots,
    seed: seedWorld,
    steps: [{ calls: [{ toolName: 'update_thread', input: UPDATE_THREAD }] }],
    merge: false,
  },
  {
    name: 'merge_threads',
    slots: threadsSlots,
    seed: seedWorld,
    steps: [{ calls: [{ toolName: 'merge_threads', input: MERGE }] }],
    merge: true,
  },
  {
    name: 'update_thread on the kept row, then merge_threads',
    slots: threadsSlots,
    seed: seedWorld,
    steps: [
      { calls: [{ toolName: 'update_thread', input: UPDATE_KEPT }] },
      { calls: [{ toolName: 'merge_threads', input: MERGE }] },
    ],
    merge: true,
  },
  ABSORBED_WROTE_CASE,
  LORE_ACROSS_PARTS_CASE,
  LORE_KEYWORDS_CASE,
  UPDATE_PLACE_CASE,
  UPDATE_ITEM_CASE,
  SET_KEYWORDS_CASE,
  MARK_COMMON_CASE,
  RETIRE_CASE,
  FLAG_CASE,
  THREADS_ACROSS_PARTS_CASE,
]

/** C9's arms; chapter delete's two modes join here (5.12). */
const ARMS: readonly RoundTripArm[] = [
  {
    name: 'CTRL-Z',
    expect: 'before-close',
    run: async (h) => {
      await h.close()
      await undoClose(h)
    },
  },
  {
    name: 'redo',
    expect: 'after-close',
    run: async (h) => {
      await h.close()
      await undoClose(h)
      expect(await redoLastAction(h.fx.branchId, h.fx.ctx)).toEqual({ status: 'ok' })
    },
  },
  {
    name: 'an abort mid-close',
    expect: 'before-close',
    run: async (h) => {
      const tx = await h.closeActingOnToolGroup(() => {
        void interruptMemoryRuns(h.fx.branchId)
      })
      const group = defined(h.actedOn(), 'the abort never fired: no tool group landed')
      expect(group.kinds, 'the group the abort fired on').not.toContain('createChapter')
      expect(tx.outcome).toBe('aborted')
    },
  },
  {
    name: 'a rollback past E',
    expect: 'after-close',
    run: async (h) => {
      await h.close()
      const pastEnd = h.fx.entries[h.fx.entries.findIndex((e) => e.id === h.endEntryId) + 1]
      await h.rollBack(pastEnd.id)
    },
  },
  {
    name: 'a rollback to E',
    expect: 'before-close',
    run: async (h) => {
      await h.close()
      await h.rollBack(h.endEntryId)
    },
  },
]

describe.each(CASES)('the round trip of $name', (c) => {
  it.each(ARMS)('$name leaves the database $expect', async (arm) => {
    const h = await openHarness(c)

    await arm.run(h)

    const expected = arm.expect === 'before-close' ? { state: h.before, log: [] } : h.closed()
    const own = c.armExpect?.[arm.name]
    if (own === undefined) expect(await worldState(h.fx)).toEqual(expected.state)
    else await own(h)
    expect(await deltasOf(h.fx, h.actionId())).toEqual(expected.log)
    const target = h.rolledBackTo()
    const others = (await branchLog(h.fx)).filter((d) => d.actionId !== h.actionId())
    expect(others, "other actions' deltas").toEqual(
      target === undefined ? h.beforeLog : keptByRollback(h, target),
    )
  })
})

describe('the stand-in task', () => {
  it('lands its create and its update as one group on E, and the report records the call', async () => {
    const h = await openHarness(STAND_IN_CASE)
    const toolGroups: { kinds: string[]; entryId: string }[] = []
    pipelineEventBus.subscribe('delta_group_emitted', (event) => {
      if (event.actions.some((a) => a.kind === 'createChapter')) return
      toolGroups.push({ kinds: event.actions.map((a) => a.kind), entryId: event.entryId })
    })

    await h.close()

    expect(toolGroups).toEqual([{ kinds: ['createLore', 'updateEntity'], entryId: h.endEntryId }])
    const [character] = await h.fx.ctx.db
      .select()
      .from(entities)
      .where(eq(entities.id, CHARACTER_ID))
    expect(character.description).toBe(STAND_IN_INPUT.description)
    const [created] = await h.fx.ctx.db.select().from(lore).where(eq(lore.branchId, h.fx.branchId))
    expect(created).toMatchObject({ title: STAND_IN_INPUT.title, body: STAND_IN_INPUT.body })
    // C1: every delta of the close, the tool's included, carries its source and E.
    const log = await deltasOf(h.fx, h.actionId())
    expect(new Set(log.map((d) => `${d.source} ${d.entryId}`))).toEqual(
      new Set([`chapter_close ${h.endEntryId}`]),
    )
    const [chapter] = await h.fx.ctx.db
      .select()
      .from(chapters)
      .where(eq(chapters.branchId, h.fx.branchId))
    expect(chapter.closeReport).toMatchObject({
      noToolCalls: false,
      stopped: [],
      calls: [
        {
          task: 'identity',
          part: 1,
          tool: 'stand_in_write',
          result: 'ok',
          why: STAND_IN_INPUT.why,
          turns: [h.fx.entries[2].id],
          rows: [
            { table: 'entities', id: CHARACTER_ID, name: 'Tobin' },
            { table: 'lore', id: created.id, name: STAND_IN_INPUT.title },
          ],
        },
      ],
    })
  })

  it('parses its sample call to what the model wrote', () => {
    assertReplaySafe(standInTool.schema, [STAND_IN_INPUT])
  })

  it('shows the active character, past a retired one and a faction that come first', async () => {
    const fx = await openCloseFixture()
    const retired: SeedEntity = {
      id: 'char_9e4a7c21-3b5d-4f68-8a1e-6c2d0b7f3e95',
      kind: 'character',
      name: 'Ansel',
      description: 'The ferryman before Tobin.',
      status: 'retired',
    }
    const faction: SeedEntity = {
      id: 'fact_2d8f1b6a-4c3e-4a97-b5d0-8e7c6a1f2b43',
      kind: 'faction',
      name: 'Brine Guild',
      description: 'The rivermen of Harrow.',
      status: 'active',
    }
    // Before Tobin by insertion and by name.
    await seedEntity(fx, retired)
    await seedEntity(fx, faction)
    await seedEntity(fx, TOBIN)
    __setCloseAgentSlots(standInSlots())
    script(STAND_IN_CASE.steps)

    const tx = expectRan(await startManualClose(fx.branchId, fx.replyIds[END_REPLY], fx.ctx))

    expect(tx).toMatchObject({ outcome: 'completed' })
    const [, request] = defined(generateToolStepMock.mock.calls[0], 'no step was sent')
    expect(request.prompt.user).toContain(TOBIN.name)
    expect(request.prompt.user).not.toContain(retired.name)
    expect(request.prompt.user).not.toContain(faction.name)
    const described = await fx.ctx.db
      .select({ name: entities.name, description: entities.description })
      .from(entities)
      .where(eq(entities.branchId, fx.branchId))
      .orderBy(asc(entities.name))
    expect(described).toEqual([
      { name: retired.name, description: retired.description },
      { name: faction.name, description: faction.description },
      { name: TOBIN.name, description: STAND_IN_INPUT.description },
    ])
  })

  it('shows nothing and sends no step on a branch with no active character', async () => {
    const fx = await openCloseFixture()
    __setCloseAgentSlots(standInSlots())

    const tx = expectRan(await startManualClose(fx.branchId, fx.replyIds[END_REPLY], fx.ctx))

    expect(tx).toMatchObject({ outcome: 'completed' })
    expect(generateToolStepMock).not.toHaveBeenCalled()
    const [chapter] = await fx.ctx.db
      .select()
      .from(chapters)
      .where(eq(chapters.branchId, fx.branchId))
    expect(chapter.closeReport).toMatchObject({ calls: [], noToolCalls: true })
  })
})

describe('a merge of a row this close already wrote', () => {
  it('is refused, deletes nothing, and leaves the earlier update standing', async () => {
    const h = await openHarness(ABSORBED_WROTE_CASE)

    await h.close()

    const [chapter] = await h.fx.ctx.db
      .select()
      .from(chapters)
      .where(eq(chapters.branchId, h.fx.branchId))
    expect(chapter.closeReport).toMatchObject({
      calls: [
        { task: 'threads', tool: 'update_thread', result: 'ok' },
        {
          task: 'threads',
          tool: 'merge_threads',
          result: 'rejected',
          reason: expect.stringContaining('keep that thread instead'),
        },
      ],
    })
    const threadDeltas = (await deltasOf(h.fx, h.actionId())).filter(
      (d) => d.targetTable === 'threads',
    )
    expect(threadDeltas.map((d) => `${d.op} ${d.targetId}`)).toEqual([`update ${THREAD_B.id}`])
    const [absorbed] = await h.fx.ctx.db
      .select()
      .from(threads)
      .where(and(eq(threads.branchId, h.fx.branchId), eq(threads.id, THREAD_B.id)))
    expect(absorbed?.description).toBe(UPDATE_ABSORBED.description)
  })
})

describe('the round trip table', () => {
  it("scripts every production task's write tool in some case (C9)", () => {
    const writeTools = PRODUCTION_CLOSE_SLOTS.perPart.flatMap((entry) =>
      entry.kind === 'task'
        ? entry.def.tools.flatMap((tool) => (tool.kind === 'write' ? [tool.name] : []))
        : [],
    )
    expect(writeTools).toEqual(
      expect.arrayContaining([
        'create_lore',
        'update_lore',
        'update_place',
        'update_item',
        'set_keywords',
        'mark_common_knowledge',
        'retire_entity',
        'flag_duplicate',
      ]),
    )
    const scripted = new Set(
      CASES.flatMap((c) => c.steps.flatMap((step) => step.calls.map((call) => call.toolName))),
    )
    expect(writeTools.filter((tool) => !scripted.has(tool))).toEqual([])
  })

  it("names only real arms in a case's own expectations", () => {
    const arms = new Set(ARMS.map((arm) => arm.name))
    for (const c of CASES)
      for (const name of Object.keys(c.armExpect ?? {}))
        expect(arms.has(name), `${c.name}: ${name}`).toBe(true)
    expect(Object.keys(FLAG_CASE.armExpect ?? {})).toEqual(['a rollback past E', 'a rollback to E'])
  })
})

// A round trip passes whatever a case wrote: these pin that each case wrote what it is named for.
describe('each new case lands what it names', () => {
  async function closedHarness(c: RoundTripCase): Promise<CloseHarness> {
    const h = await openHarness(c)
    await h.close()
    return h
  }

  // The report's write calls, reads left out.
  async function writeCalls(h: CloseHarness) {
    const [chapter] = await h.fx.ctx.db
      .select()
      .from(chapters)
      .where(eq(chapters.branchId, h.fx.branchId))
    return (chapter?.closeReport?.calls ?? []).filter(
      (call) => call.tool !== 'read_row' && call.tool !== 'search_world',
    )
  }

  async function entityRow(h: CloseHarness, id: string) {
    const [row] = await h.fx.ctx.db
      .select()
      .from(entities)
      .where(and(eq(entities.branchId, h.fx.branchId), eq(entities.id, id)))
    return defined(row, `no entity ${id}`)
  }

  it('create_lore in part 1, then update_lore of that row in part 2', async () => {
    const h = await closedHarness(LORE_ACROSS_PARTS_CASE)

    expect((await writeCalls(h)).map((call) => [call.part, call.tool, call.result])).toEqual([
      [1, 'create_lore', 'ok'],
      [2, 'update_lore', 'ok'],
    ])
    const rows = await h.fx.ctx.db.select().from(lore).where(eq(lore.branchId, h.fx.branchId))
    expect(rows.map(({ title, body, keywords }) => ({ title, body, keywords }))).toEqual([
      { title: LORE_CREATE.title, body: LORE_UPDATE_CREATED.body, keywords: LORE_CREATE.keywords },
    ])
  })

  it('update_thread in part 1, then merge_threads absorbing that row in part 2: the merge is refused', async () => {
    const h = await closedHarness(THREADS_ACROSS_PARTS_CASE)

    const calls = await writeCalls(h)
    expect(calls.map((call) => [call.part, call.tool, call.result])).toEqual([
      [1, 'update_thread', 'ok'],
      [2, 'merge_threads', 'rejected'],
    ])
    expect(calls[1]!.reason).toContain('keep that thread instead')
    const threadDeltas = (await deltasOf(h.fx, h.actionId())).filter(
      (d) => d.targetTable === 'threads',
    )
    expect(threadDeltas.map((d) => `${d.op} ${d.targetId}`)).toEqual([`update ${THREAD_B.id}`])
  })

  it("update_lore: a category and setLoreKeywords' add and removal in one group", async () => {
    const h = await closedHarness(LORE_KEYWORDS_CASE)

    const [row] = await h.fx.ctx.db.select().from(lore).where(eq(lore.id, TOLL_LORE.id))
    expect(row).toMatchObject({ category: 'Law', keywords: ['ferry toll'] })
    expect(
      (await deltasOf(h.fx, h.actionId())).filter((d) => d.targetTable === 'lore'),
    ).toHaveLength(2)
  })

  it('update_place: the condition and a parent in one delta, unplaced cleared', async () => {
    const h = await closedHarness(UPDATE_PLACE_CASE)

    const harrow = await entityRow(h, HARROW.id)
    expect(harrow.state).toMatchObject({
      parent_location_id: RIVER_COUNTRY.id,
      condition: UPDATE_PLACE.condition,
    })
    expect(harrow.state).not.toHaveProperty('unplaced')
    expect(
      (await deltasOf(h.fx, h.actionId())).filter((d) => d.targetId === HARROW.id),
    ).toHaveLength(1)
  })

  it("update_item: the satchel's condition and description", async () => {
    const h = await closedHarness(UPDATE_ITEM_CASE)

    const satchel = await entityRow(h, SATCHEL.id)
    expect(satchel.description).toBe(UPDATE_ITEM.description)
    expect(satchel.state).toMatchObject({ condition: UPDATE_ITEM.condition })
  })

  it("set_keywords: an add and a pass's term removed, in one delta", async () => {
    const h = await closedHarness(SET_KEYWORDS_CASE)

    expect((await entityRow(h, TOBIN.id)).keywords).toEqual(['old tobin'])
    expect(
      (await deltasOf(h.fx, h.actionId())).filter((d) => d.targetId === TOBIN.id),
    ).toHaveLength(1)
  })

  it('mark_common_knowledge: the happening is common knowledge', async () => {
    const h = await closedHarness(MARK_COMMON_CASE)

    const [crossing] = await h.fx.ctx.db
      .select()
      .from(happenings)
      .where(eq(happenings.id, CROSSING_HAPPENING.id))
    expect(crossing?.commonKnowledge).toBe(1)
  })

  it('retire_entity: Tobin retired, the why as his reason', async () => {
    const h = await closedHarness(RETIRE_CASE)

    expect(await entityRow(h, TOBIN.id)).toMatchObject({
      status: 'retired',
      retiredReason: RETIRE.why,
    })
  })

  it("flag_duplicate: Tobin flagged as the later turn's row", async () => {
    const h = await closedHarness(FLAG_CASE)

    expect(await entityRow(h, TOBIN.id)).toMatchObject({
      nameCollisionFlag: 1,
      nameCollisionPartnerId: FERRYMAN.id,
      nameCollisionReason: 'duplicate',
    })
  })
})
