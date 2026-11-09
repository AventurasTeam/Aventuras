import type { AssistantModelMessage, ToolCallPart } from 'ai'
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm'
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
  generateStructured,
  generateToolStep,
  ToolStep,
  ToolStepCall,
  ToolStepResult,
} from '@/lib/ai'
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
  type CloseFixture,
} from '../definitions/__tests__/close-fixture'
import { identityTask } from '../definitions/close-agent/identity'
import { __setCloseAgentSlots, type CloseAgentSlots } from '../definitions/close-agent/slots'
import { threadsTask } from '../definitions/close-agent/threads'
import { assertReplaySafe } from '../definitions/close-agent/tool'

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
  kind: 'character' | 'faction'
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
  readonly merge: boolean
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
  const fx = await openCloseFixture()
  await seedEntity(fx, TOBIN)
  await c.seed?.(fx)
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
    merge: c.merge,
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
  const log = await deltasOf(h.fx, h.actionId())
  if (h.merge)
    expect(
      log.some((d) => d.op === 'delete'),
      'a merge case deletes the row it absorbs',
    ).toBe(true)
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
    expect(await worldState(h.fx)).toEqual(expected.state)
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
        { task: 'threads', tool: 'merge_threads', result: 'rejected' },
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
