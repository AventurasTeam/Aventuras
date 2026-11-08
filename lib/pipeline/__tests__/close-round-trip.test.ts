import type { AssistantModelMessage, ToolCallPart } from 'ai'
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startManualClose } from '@/lib/actions/chapters/start-manual-close'
import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
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
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  storyEntries,
  threads,
  type Delta,
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
import { __setCloseAgentSlots, type CloseAgentSlots } from '../definitions/close-agent/slots'
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

// t3 is position 3: a group anchored on the cited turn instead of E would survive a rollback to
// position 5, which the rollback-into-the-chapter arm catches.
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

async function deltasOf(fx: CloseFixture, actionId: string): Promise<Delta[]> {
  return (await fx.ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, fx.branchId), eq(deltas.actionId, actionId)))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

// A pass's create anchored on the first reply: both rollbacks below spare it.
async function seedCharacter(fx: CloseFixture): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: CHARACTER_ID,
            branchId: fx.branchId,
            kind: 'character',
            name: 'Tobin',
            description: 'The ferryman at Harrow.',
            status: 'active',
            injectionMode: 'auto',
            createdAt: 1_767_225_700_000,
            updatedAt: 1_767_225_700_000,
          },
        },
      },
      actionId: 'act_close_seed_pass',
      branchId: fx.branchId,
      entryId: fx.replyIds[0],
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`round trip: seed refused: ${result.reason}`)
}

type CloseHarness = {
  readonly fx: CloseFixture
  /** E: the case's close ends on the third reply of six. */
  readonly endEntryId: string
  readonly merge: boolean
  /** The state before the close ran. */
  readonly before: WorldState
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
  await seedCharacter(fx)
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
  let actionId: string | undefined
  let closed: { state: WorldState; log: Delta[] } | undefined
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

async function rollBack(h: CloseHarness, targetId: string): Promise<void> {
  const counts = await shownCounts(h.fx.branchId, targetId, h.fx.ctx)
  expect(
    await rollbackToEntry(h.fx.branchId, targetId, h.fx.ctx, { expectedCounts: counts }),
  ).toEqual({ status: 'ok', counts })
}

type RoundTripCase = {
  name: string
  slots: () => CloseAgentSlots
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

/** C9: every tool's landed group joins this table. */
const CASES: readonly RoundTripCase[] = [STAND_IN_CASE]

/** C9's arms; 5.12 adds chapter delete's two modes here. */
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
      await rollBack(h, pastEnd.id)
    },
  },
  {
    name: 'a rollback into the chapter',
    expect: 'before-close',
    run: async (h) => {
      await h.close()
      await rollBack(h, h.fx.replyIds[END_REPLY - 1])
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
