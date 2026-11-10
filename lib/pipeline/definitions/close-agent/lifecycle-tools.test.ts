import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import {
  USER_EDITED_SINCE_PROSE,
  type GroupOutcome,
  type PipelineAction,
} from '@/lib/actions/types'
import {
  branches,
  deltas,
  emptyEntityState,
  entities,
  storyEntries,
  type CollisionReason,
  type Entity,
  type EntityState,
  type NewEntity,
} from '@/lib/db'
import { changedPaths } from '@/lib/history/humanize'
import { resetAllStores } from '@/lib/stores'
import { collisionPairOf, entityKeepActions, flagStillHolds } from '@/lib/world'

import { createReadSet } from './common-checks'
import { dispatchToolCall, type DispatchContext, type ToolAnswer } from './dispatch'
import { CloseLedgerWriter } from './ledger'
import { type FLAG_DUPLICATE_SHAPE, flagDuplicateTool, retireEntityTool } from './lifecycle-tools'
import { turnInTextReason } from './text-checks'
import { assertReplaySafe, type CloseTool, type WriteTool } from './tool'
import { CLOSE_REASON } from './verdict'
import { expectRan } from '../../__tests__/harness'
import { definePipeline } from '../../authoring/define'
import { getPipelineSafe } from '../../authoring/registry'
import { runPipeline } from '../../runtime/orchestrator'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, TxResult } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeIdsOf, seedCloseLedger } from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

// ---- Fixture helpers ----

// Real `prefix_<uuid>` ids: CloseIds.show allocates handles for those only.
const TOBIN = 'char_00000000-0000-4000-8000-00000000e001'
const STRANGER = 'char_00000000-0000-4000-8000-00000000e002'
const CLERK = 'char_00000000-0000-4000-8000-00000000e003'
const WREN = 'char_00000000-0000-4000-8000-00000000e004'
const NAMESAKE = 'char_00000000-0000-4000-8000-00000000e005'
const LANTERN = 'item_00000000-0000-4000-8000-00000000e006'
const SYNDICATE = 'fact_00000000-0000-4000-8000-00000000e007'
const HARROW = 'loc_00000000-0000-4000-8000-00000000e008'
// Shown to the model, never seeded: a row that is gone.
const GONE = 'char_00000000-0000-4000-8000-00000000e009'

/** The chapter: the opening to the third reply, t1…t7. E is that reply. */
const chapterIds = (f: CloseFixture): string[] => f.entries.slice(0, 7).map((entry) => entry.id)
const endEntryId = (f: CloseFixture): string => f.entries[6]!.id
/** The fifth reply (position 11): past E, under the fixture's act_close_turn_5. */
const laterReplyId = (f: CloseFixture): string => f.replyIds[4]!

type RowSpec = {
  id: string
  kind: NewEntity['kind']
  name: string
  status?: NewEntity['status']
  keywords?: string[]
  /** The flag the row holds as it is created. */
  flag?: { partnerId: string; reason: CollisionReason }
}

/** A row a pass created before the chapter: unanchored, under an action no turn owns. */
async function seedRow(f: CloseFixture, spec: RowSpec): Promise<void> {
  const status = spec.status ?? 'active'
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: spec.id,
            branchId: f.branchId,
            kind: spec.kind,
            name: spec.name,
            description: null,
            status,
            retiredReason: status === 'retired' ? 'Left the story.' : null,
            injectionMode: 'auto',
            keywords: spec.keywords ?? [],
            state: emptyEntityState(spec.kind) as EntityState,
            ...(spec.flag === undefined
              ? {}
              : {
                  nameCollisionFlag: 1,
                  nameCollisionPartnerId: spec.flag.partnerId,
                  nameCollisionReason: spec.flag.reason,
                }),
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      actionId: 'act_seed_world',
      branchId: f.branchId,
      entryId: null,
    },
    f.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seeding ${spec.name} refused: ${result.reason}`)
}

async function write(
  f: CloseFixture,
  action: PipelineAction,
  actionId: string,
  entryId: string | null,
): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: f.branchId, entryId }, f.ctx)
  if (result.status !== 'ok') throw new Error(`${action.kind} refused: ${result.reason}`)
}

/** World's Keep as distinct on the pair whose flag `holder` holds, as the user resolves it. */
async function keepPair(f: CloseFixture, holder: string, partner: string): Promise<void> {
  const rows = await f.ctx.db.select().from(entities).where(eq(entities.branchId, f.branchId))
  const lookup = collisionPairOf(rows, [holder, partner])
  if (!('pair' in lookup)) throw new Error(`keepPair: ${holder} and ${partner} are no flagged pair`)
  for (const action of entityKeepActions({
    branchId: f.branchId,
    pair: lookup.pair,
    branchEntities: rows,
  }))
    await write(f, action, 'act_user_keep', null)
}

async function setSceneOf(f: CloseFixture, entryId: string, ids: readonly string[]): Promise<void> {
  const where = and(eq(storyEntries.branchId, f.branchId), eq(storyEntries.id, entryId))
  const [row] = await f.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  if (!row?.metadata) throw new Error(`setSceneOf: entry ${entryId} has no metadata`)
  await f.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row.metadata, sceneEntities: [...ids] } })
    .where(where)
}

/** A turn written after the fixture's, as the fixture writes one: the reply anchored on itself. */
async function appendTurnEntry(
  f: CloseFixture,
  entry: { id: string; position: number; kind: 'user_action' | 'ai_reply'; content: string },
): Promise<void> {
  await write(
    f,
    {
      kind: 'createStoryEntry',
      source: entry.kind === 'user_action' ? 'user_edit' : 'ai_classifier',
      payload: {
        entry: {
          ...entry,
          branchId: f.branchId,
          chapterId: null,
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: entry.position * 60 },
          createdAt: 1_767_225_600_000 + entry.position,
        },
      },
    },
    `act_late_turn_${entry.position}`,
    entry.kind === 'ai_reply' ? entry.id : null,
  )
}

/** On a two-turn fixture (t1–t5): appends t6, t7 (E), so an earlier write lands before E. */
async function appendLateTurns(
  f: CloseFixture,
): Promise<{ endEntryId: string; taskEntryIds: string[] }> {
  await appendTurnEntry(f, {
    id: 'entry_late_006',
    position: 6,
    kind: 'user_action',
    content: 'I ask who keeps the far bank.',
  })
  await appendTurnEntry(f, {
    id: 'entry_late_007',
    position: 7,
    kind: 'ai_reply',
    content: 'Tobin pulls his hood low and says nothing.',
  })
  return {
    endEntryId: 'entry_late_007',
    taskEntryIds: [...f.entries.map((entry) => entry.id), 'entry_late_006', 'entry_late_007'],
  }
}

async function storedEntity(f: CloseFixture, id: string): Promise<Entity> {
  const [found] = await f.ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, f.branchId), eq(entities.id, id)))
  if (found === undefined) throw new Error(`no entity ${id}`)
  return found
}

function runDeltas(f: CloseFixture, actionId: string) {
  return f.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(asc(deltas.logPosition))
}

const WHY = 'He goes into the black water at the landing and does not come up.'
const cite = (turns: readonly string[] = ['t7'], why = WHY) => ({ turns: [...turns], why })

// ---- A scripted dispatch: the calls run as the agent phase runs them ----

type ShownRow = { id: string; name: string }
type ScriptedCall = { toolName: string; input: Record<string, unknown> }
type DispatchRun = {
  result: TxResult
  /** Each scripted call's answer, in order. */
  answers: readonly ToolAnswer[]
  calls: CloseLedger['calls']
}

const SCRIPTED_KIND = 'close-lifecycle-tools-test'

/** flag_duplicate whose partner takes a live flag naming Tobin after the plan reads. */
const flagDuplicateRaced: WriteTool<typeof FLAG_DUPLICATE_SHAPE> = {
  ...flagDuplicateTool,
  plan: async (args, ctx) => {
    const plan = await flagDuplicateTool.plan(args, ctx)
    await ctx.db
      .update(entities)
      .set({ nameCollisionFlag: 1, nameCollisionPartnerId: TOBIN, nameCollisionReason: 'alike' })
      .where(and(eq(entities.branchId, ctx.branchId), eq(entities.id, STRANGER)))
    return plan
  },
}

const LIFECYCLE_TOOLS: Readonly<Record<string, CloseTool>> = {
  retire_entity: retireEntityTool,
  flag_duplicate: flagDuplicateTool,
  flag_duplicate_raced: flagDuplicateRaced,
}

type PendingRun = {
  calls: readonly ScriptedCall[]
  shown: readonly ShownRow[]
  endEntryId: string
  taskEntryIds: readonly string[]
  answers: ToolAnswer[]
  ledger?: CloseLedger
}
let pending: PendingRun | undefined

// Stands where the agent phase will: the task's turns, the shown rows, all of them read.
async function* scriptedPhase(
  phase: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const run = pending
  if (run === undefined) throw new Error('no scripted calls')
  const ids = closeIdsOf(phase.intermediates)
  ids.showTurns(run.taskEntryIds)
  for (const { id, name } of run.shown) ids.show(id, name)
  const ledger = seedCloseLedger(phase.intermediates)
  run.ledger = ledger
  const writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id), phase.actionId)
  const readSet = createReadSet()
  readSet.add(run.shown.map(({ id }) => ({ table: 'entities' as const, id })))
  const ctx: DispatchContext = {
    db: phase.db,
    branchId: phase.branchId,
    endEntryId: run.endEntryId,
    task: 'lifecycle',
    part: 1,
    ids,
    readFields: {},
    survivorOf: (table, id) => writer.survivorOf(table, id),
    landedCalls: (tool) => writer.landedCalls(tool),
    phase,
    taskEntryIds: run.taskEntryIds,
    readSet,
    ledger: writer,
  }
  for (const [index, { toolName, input }] of run.calls.entries()) {
    const tool = LIFECYCLE_TOOLS[toolName]
    if (tool === undefined) throw new Error(`no lifecycle tool ${toolName}`)
    run.answers.push(
      yield* dispatchToolCall({ toolCallId: `call_${index + 1}`, toolName, input }, tool, ctx),
    )
  }
  return { status: 'completed' }
}

/** Runs `calls` in one close-like run; `shown` shown and read in order, the chapter by default. */
async function dispatchScripted(
  f: CloseFixture,
  calls: readonly ScriptedCall[],
  opts: { shown: readonly ShownRow[]; endEntryId?: string; taskEntryIds?: readonly string[] },
): Promise<DispatchRun> {
  if (getPipelineSafe(SCRIPTED_KIND) === undefined)
    definePipeline({
      kind: SCRIPTED_KIND,
      phases: [{ name: 'agent', run: scriptedPhase }],
      affordance: 'invisible',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    })
  const run: PendingRun = {
    calls,
    shown: opts.shown,
    endEntryId: opts.endEntryId ?? endEntryId(f),
    taskEntryIds: opts.taskEntryIds ?? chapterIds(f),
    answers: [],
  }
  pending = run
  try {
    const result = expectRan(
      await runPipeline(SCRIPTED_KIND, {
        storyId: f.storyId,
        branchId: f.branchId,
        db: f.ctx.db,
        runInTransaction: f.ctx.runInTransaction,
      }),
    )
    expect(result.outcome).toBe('completed')
    if (run.ledger === undefined) throw new Error('the scripted phase never ran')
    return { result, answers: run.answers, calls: run.ledger.calls }
  } finally {
    pending = undefined
  }
}

const outputs = (answers: readonly ToolAnswer[]) => answers.map(({ output }) => output)

afterEach(() => {
  resetAllStores()
})

// ---- The tools ----

describe('retire_entity and flag_duplicate: the tools', () => {
  it('replay as sent, strict at the top', () => {
    assertReplaySafe(retireEntityTool.schema, [
      { id: 'c1', turns: ['t7'], why: 'He drowns.' },
      { id: ' c1 ', turns: ['t1', 't7'], why: '' },
    ])
    assertReplaySafe(flagDuplicateTool.schema, [
      { id: 'c1', partner: 'c2', turns: ['t7'], why: 'One man under two names.' },
    ])
  })

  it("tells the model flag_duplicate's rule: both rows' flags taken, or a pair kept apart", () => {
    expect(flagDuplicateTool.description).toContain(
      "A pair already flagged is marked as the same, whichever row holds the flag. A row holds one flag, so it is refused when both rows' flags already name other rows, and for a pair the user already kept apart.",
    )
    expect(flagDuplicateTool.description).not.toContain('third row')
  })

  it("take entity ids of any kind under canon's names, a place included so the plan answers it", () => {
    const prefixes = ['char_', 'loc_', 'item_', 'fact_']
    expect(retireEntityTool).toMatchObject({
      kind: 'write',
      name: 'retire_entity',
      ids: { id: { shape: 'single', prefixes } },
    })
    expect(flagDuplicateTool).toMatchObject({
      kind: 'write',
      name: 'flag_duplicate',
      ids: {
        id: { shape: 'single', prefixes },
        partner: { shape: 'single', prefixes },
      },
    })
  })
})

describe('retire_entity', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
  })

  it.each([
    { kind: 'character', id: TOBIN, name: 'Tobin', handle: 'c1' },
    { kind: 'item', id: LANTERN, name: 'Lantern', handle: 'i1' },
    { kind: 'faction', id: SYNDICATE, name: 'The Syndicate', handle: 'f1' },
  ] as const)(
    'retires a $kind with why as the reason, one delta as chapter_close on E',
    async ({ kind, id, name, handle }) => {
      await seedRow(f, { id, kind, name })

      const { result, answers, calls } = await dispatchScripted(
        f,
        [{ toolName: 'retire_entity', input: { id: handle, ...cite() } }],
        { shown: [{ id, name }] },
      )

      expect(outputs(answers)).toEqual([{ result: 'ok' }])
      expect(await storedEntity(f, id)).toMatchObject({ status: 'retired', retiredReason: WHY })
      const log = await runDeltas(f, result.actionId)
      expect(log.map((d) => [d.targetTable, d.targetId, d.op, d.source, d.entryId])).toEqual([
        ['entities', id, 'update', 'chapter_close', endEntryId(f)],
      ])
      expect(calls).toEqual([
        {
          task: 'lifecycle',
          part: 1,
          tool: 'retire_entity',
          rows: [{ table: 'entities', id, name }],
          why: WHY,
          turns: [endEntryId(f)],
          result: 'ok',
          values: { status: 'retired' },
        },
      ])
      // C4: a landed call's values sit among the paths its delta changed.
      expect(changedPaths(log[0]!)).toEqual(expect.arrayContaining(['status']))
    },
  )

  it("retires the close's own row when a fork holds the same id already retired", async () => {
    // Inserted first, under a branch id sorting before the close's: a read that drops the branch
    // meets the fork's row first, by rowid or by the key.
    const fork = 'br_a_fork'
    await f.ctx.db.insert(branches).values({
      id: fork,
      storyId: f.storyId,
      parentBranchId: f.branchId,
      name: 'fork',
      createdAt: 2,
    })
    await f.ctx.db.insert(entities).values({
      id: TOBIN,
      branchId: fork,
      kind: 'character',
      name: 'Tobin',
      status: 'retired',
      retiredReason: 'Sails for the far coast.',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })

    const { answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite() } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([{ result: 'ok' }])
    expect(await storedEntity(f, TOBIN)).toMatchObject({ status: 'retired', retiredReason: WHY })
    const [forkRow] = await f.ctx.db
      .select()
      .from(entities)
      .where(and(eq(entities.branchId, fork), eq(entities.id, TOBIN)))
    expect(forkRow).toMatchObject({ status: 'retired', retiredReason: 'Sails for the far coast.' })
  })

  it('stores why trimmed, a row handle in it named', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })
    await seedRow(f, { id: WREN, kind: 'character', name: 'Wren' })

    await dispatchScripted(
      f,
      [
        {
          toolName: 'retire_entity',
          input: { id: 'c1', ...cite(['t7'], '  c2 holds him under at the landing.  ') },
        },
      ],
      {
        shown: [
          { id: TOBIN, name: 'Tobin' },
          { id: WREN, name: 'Wren' },
        ],
      },
    )

    expect((await storedEntity(f, TOBIN)).retiredReason).toBe(
      'Wren holds him under at the landing.',
    )
  })

  it.each(['active', 'retired'] as const)(
    'refuses a %s place before reading its status, writing nothing',
    async (status) => {
      await seedRow(f, { id: HARROW, kind: 'location', name: 'Harrow', status })

      const { result, answers, calls } = await dispatchScripted(
        f,
        [{ toolName: 'retire_entity', input: { id: 'l1', ...cite() } }],
        { shown: [{ id: HARROW, name: 'Harrow' }] },
      )

      expect(outputs(answers)).toEqual([
        { result: 'rejected', reason: 'location', note: expect.stringContaining('Only the user') },
      ])
      expect(await runDeltas(f, result.actionId)).toEqual([])
      expect((await storedEntity(f, HARROW)).status).toBe(status)
      expect(calls[0]).toMatchObject({
        result: 'rejected',
        reason: 'location',
        values: { status: 'retired' },
      })
    },
  )

  it('answers ok with nothing written on a row already retired, recording no value', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin', status: 'retired' })

    const { result, answers, calls } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite() } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([{ result: 'ok' }])
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, TOBIN)).retiredReason).toBe('Left the story.')
    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('values')
  })

  it('refuses a staged row as not active, writing nothing', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin', status: 'staged' })

    const { result, answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite() } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([
      { result: 'rejected', reason: 'not-active', note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, TOBIN)).status).toBe('staged')
  })

  it('refuses a character a reply after E has in its scene', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })
    await setSceneOf(f, f.entries[8]!.id, [TOBIN])

    const { result, answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite() } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([
      { result: 'rejected', reason: 'in-scene-later', note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it("refuses, in part 1, a character a reply of part 2 has in its scene: the part's turns are older", async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })
    // Part 1 is t1-t5; E (t7), part 2's reply, holds him.
    await setSceneOf(f, endEntryId(f), [TOBIN])

    const { result, answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite(['t5']) } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }], taskEntryIds: chapterIds(f).slice(0, 5) },
    )

    expect(outputs(answers)).toEqual([
      { result: 'rejected', reason: 'in-scene-later', note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('retires a character only the action after E has in scene, which carries E forward', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })
    await setSceneOf(f, endEntryId(f), [TOBIN])
    await setSceneOf(f, f.entries[7]!.id, [TOBIN])

    const { answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite() } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([{ result: 'ok' }])
    expect((await storedEntity(f, TOBIN)).status).toBe('retired')
  })

  it('retires an item a reply after E has in scene: only a character is checked', async () => {
    await seedRow(f, { id: LANTERN, kind: 'item', name: 'Lantern' })
    await setSceneOf(f, f.entries[8]!.id, [LANTERN])

    const { answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'i1', ...cite() } }],
      { shown: [{ id: LANTERN, name: 'Lantern' }] },
    )

    expect(outputs(answers)).toEqual([{ result: 'ok' }])
  })

  it.each(['As t5 shows, he drowns at the landing.', 'He drowns at the landing [t5].'])(
    'refuses a turn handle in why, stored as the reason: %s',
    async (why) => {
      await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })

      const { result, answers } = await dispatchScripted(
        f,
        [{ toolName: 'retire_entity', input: { id: 'c1', ...cite(['t7'], why) } }],
        { shown: [{ id: TOBIN, name: 'Tobin' }] },
      )

      expect(outputs(answers)).toEqual([
        { result: 'rejected', reason: turnInTextReason('t5'), note: expect.any(String) },
      ])
      expect(await runDeltas(f, result.actionId)).toEqual([])
    },
  )

  it('keeps a token that names no turn of the close', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })

    const { answers } = await dispatchScripted(
      f,
      [
        {
          toolName: 'retire_entity',
          input: { id: 'c1', ...cite(['t7'], 'He drowns past mile t99.') },
        },
      ],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([{ result: 'ok' }])
    expect((await storedEntity(f, TOBIN)).retiredReason).toBe('He drowns past mile t99.')
  })

  it('skips a row whose status a later turn wrote, before the handler reads it', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin', status: 'staged' })
    await write(
      f,
      {
        kind: 'promoteStagedEntity',
        source: 'per_turn_classifier',
        payload: { branchId: f.branchId, id: TOBIN, proseEntryId: laterReplyId(f) },
      },
      'act_close_turn_5',
      laterReplyId(f),
    )

    const { result, answers, calls } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite() } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([
      { result: 'skipped', reason: CLOSE_REASON.laterTurn, note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, TOBIN)).status).toBe('active')
    expect(calls[0]).toMatchObject({ result: 'skipped', values: { status: 'retired' } })
  })

  it('skips a row whose status a later turn wrote before refusing a turn handle in why', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin', status: 'staged' })
    await write(
      f,
      {
        kind: 'promoteStagedEntity',
        source: 'per_turn_classifier',
        payload: { branchId: f.branchId, id: TOBIN, proseEntryId: laterReplyId(f) },
      },
      'act_close_turn_5',
      laterReplyId(f),
    )

    const { answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite(['t7'], 'He drowns [t5].') } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([
      { result: 'skipped', reason: CLOSE_REASON.laterTurn, note: expect.any(String) },
    ])
  })

  it('skips a row whose status the user wrote after the cited turns', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin', status: 'retired' })
    await write(
      f,
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          id: TOBIN,
          patch: { status: 'active', retiredReason: null },
        },
      },
      'act_user_edit',
      null,
    )

    const { result, answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite() } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([
      { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('skips a row whose status the user wrote after the cited turns before refusing a turn handle in why', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin', status: 'retired' })
    await write(
      f,
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          id: TOBIN,
          patch: { status: 'active', retiredReason: null },
        },
      },
      'act_user_edit',
      null,
    )

    const { result, answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite(['t7'], 'He drowns [t5].') } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }] },
    )

    expect(outputs(answers)).toEqual([
      { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, TOBIN)).status).toBe('active')
  })

  it('skips a row whose status the user wrote after the cited turn, though before E', async () => {
    f = await openCloseFixture({ turns: 2 })
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin', status: 'retired' })
    await write(
      f,
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          id: TOBIN,
          patch: { status: 'active', retiredReason: null },
        },
      },
      'act_user_edit',
      null,
    )
    const late = await appendLateTurns(f)

    const { result, answers } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite(['t5']) } }],
      { shown: [{ id: TOBIN, name: 'Tobin' }], ...late },
    )

    expect(outputs(answers)).toEqual([
      { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, TOBIN)).status).toBe('active')
  })

  it('refuses a gone row as row-gone, naming it as shown', async () => {
    const { answers, calls } = await dispatchScripted(
      f,
      [{ toolName: 'retire_entity', input: { id: 'c1', ...cite() } }],
      { shown: [{ id: GONE, name: 'Ansel' }] },
    )

    expect(outputs(answers)).toEqual([
      { result: 'rejected', reason: CLOSE_REASON.rowGone, note: expect.any(String) },
    ])
    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      rows: [{ table: 'entities', id: GONE, name: 'Ansel' }],
      values: { status: 'retired' },
    })
  })
})

describe('flag_duplicate', () => {
  let f: CloseFixture
  const SHOWN = [
    { id: TOBIN, name: 'Tobin' },
    { id: STRANGER, name: 'the hooded stranger' },
  ]
  const flagCall = (input: Record<string, unknown> = {}): ScriptedCall => ({
    toolName: 'flag_duplicate',
    input: { id: 'c1', partner: 'c2', ...cite(), ...input },
  })
  const flagOf = (row: Entity) => [
    row.nameCollisionFlag,
    row.nameCollisionPartnerId,
    row.nameCollisionReason,
  ]

  beforeEach(async () => {
    f = await openCloseFixture()
  })

  it('flags two rows with no namesake basis on the row named first, live while the partner exists', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })
    await seedRow(f, { id: STRANGER, kind: 'character', name: 'the hooded stranger' })

    const { result, answers, calls } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

    expect(outputs(answers)).toEqual([{ result: 'ok' }])
    const tobin = await storedEntity(f, TOBIN)
    const stranger = await storedEntity(f, STRANGER)
    expect(flagOf(tobin)).toEqual([1, STRANGER, 'duplicate'])
    expect(flagOf(stranger)).toEqual([0, null, null])
    expect(flagStillHolds(tobin, stranger)).toBe(true)
    const log = await runDeltas(f, result.actionId)
    expect(log.map((d) => [d.targetId, d.op, d.source, d.entryId])).toEqual([
      [TOBIN, 'update', 'chapter_close', endEntryId(f)],
    ])
    expect(calls).toEqual([
      {
        task: 'lifecycle',
        part: 1,
        tool: 'flag_duplicate',
        rows: [
          { table: 'entities', id: TOBIN, name: 'Tobin' },
          { table: 'entities', id: STRANGER, name: 'the hooded stranger' },
        ],
        why: WHY,
        turns: [endEntryId(f)],
        result: 'ok',
        values: { nameCollisionPartnerId: 'the hooded stranger' },
      },
    ])
  })

  it.each([
    { holder: TOBIN, partner: STRANGER },
    { holder: STRANGER, partner: TOBIN },
  ])(
    'answers ok with nothing written when the pair is already flagged duplicate from either side, recording no value',
    async ({ holder, partner }) => {
      await seedRow(f, {
        id: STRANGER,
        kind: 'character',
        name: 'the hooded stranger',
        flag: holder === STRANGER ? { partnerId: partner, reason: 'duplicate' } : undefined,
      })
      await seedRow(f, {
        id: TOBIN,
        kind: 'character',
        name: 'Tobin',
        flag: holder === TOBIN ? { partnerId: partner, reason: 'duplicate' } : undefined,
      })

      const { result, answers, calls } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

      expect(outputs(answers)).toEqual([{ result: 'ok' }])
      expect(await runDeltas(f, result.actionId)).toEqual([])
      expect(calls[0]).toMatchObject({ result: 'ok' })
      expect(calls[0]).not.toHaveProperty('values')
    },
  )

  it.each([
    {
      side: 'the row named first',
      holder: TOBIN,
      other: STRANGER,
      otherName: 'the hooded stranger',
    },
    { side: 'the partner', holder: STRANGER, other: TOBIN, otherName: 'Tobin' },
  ])(
    'flags a pair already in question as duplicate, on $side that holds the flag',
    async ({ holder, other, otherName }) => {
      // The stranger's keyword names Tobin, so an `alike` flag on the pair is live.
      await seedRow(f, {
        id: TOBIN,
        kind: 'character',
        name: 'Tobin',
        flag: holder === TOBIN ? { partnerId: other, reason: 'alike' } : undefined,
      })
      await seedRow(f, {
        id: STRANGER,
        kind: 'character',
        name: 'the hooded stranger',
        keywords: ['tobin'],
        flag: holder === STRANGER ? { partnerId: other, reason: 'alike' } : undefined,
      })

      const { result, answers, calls } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

      expect(outputs(answers)).toEqual([{ result: 'ok' }])
      expect(flagOf(await storedEntity(f, holder))).toEqual([1, other, 'duplicate'])
      expect(flagOf(await storedEntity(f, other))).toEqual([0, null, null])
      const [delta] = await runDeltas(f, result.actionId)
      expect(delta).toMatchObject({
        targetId: holder,
        undoPayload: { nameCollisionReason: 'alike' },
      })
      expect(calls[0]).toMatchObject({
        result: 'ok',
        rows: [expect.objectContaining({ id: holder }), expect.objectContaining({ id: other })],
        values: { nameCollisionPartnerId: otherName },
      })
    },
  )

  it('re-marks the partner flag naming the row, though the row flags a third', async () => {
    await seedRow(f, { id: CLERK, kind: 'character', name: 'the toll clerk' })
    await seedRow(f, {
      id: TOBIN,
      kind: 'character',
      name: 'Tobin',
      flag: { partnerId: CLERK, reason: 'duplicate' },
    })
    // The stranger's keyword names Tobin, so its `alike` flag on him is live.
    await seedRow(f, {
      id: STRANGER,
      kind: 'character',
      name: 'the hooded stranger',
      keywords: ['tobin'],
      flag: { partnerId: TOBIN, reason: 'alike' },
    })

    const { result, answers, calls } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

    expect(outputs(answers)).toEqual([{ result: 'ok' }])
    expect(flagOf(await storedEntity(f, STRANGER))).toEqual([1, TOBIN, 'duplicate'])
    expect(flagOf(await storedEntity(f, TOBIN))).toEqual([1, CLERK, 'duplicate'])
    const log = await runDeltas(f, result.actionId)
    expect(log.map((d) => [d.targetId, d.op])).toEqual([[STRANGER, 'update']])
    expect(calls[0]).toMatchObject({
      result: 'ok',
      rows: [
        { table: 'entities', id: STRANGER, name: 'the hooded stranger' },
        { table: 'entities', id: TOBIN, name: 'Tobin' },
      ],
      values: { nameCollisionPartnerId: 'Tobin' },
    })
  })

  it.each([
    { order: 'Tobin first', input: { id: 'c1', partner: 'c2' } },
    { order: 'the stranger first', input: { id: 'c2', partner: 'c1' } },
  ])(
    "flags the stranger naming Tobin when Tobin's live flag names a third row, $order",
    async ({ input }) => {
      await seedRow(f, { id: CLERK, kind: 'character', name: 'the toll clerk' })
      await seedRow(f, {
        id: TOBIN,
        kind: 'character',
        name: 'Tobin',
        flag: { partnerId: CLERK, reason: 'duplicate' },
      })
      await seedRow(f, { id: STRANGER, kind: 'character', name: 'the hooded stranger' })

      const { result, answers, calls } = await dispatchScripted(f, [flagCall(input)], {
        shown: SHOWN,
      })

      expect(outputs(answers)).toEqual([{ result: 'ok' }])
      expect(flagOf(await storedEntity(f, STRANGER))).toEqual([1, TOBIN, 'duplicate'])
      expect(flagOf(await storedEntity(f, TOBIN))).toEqual([1, CLERK, 'duplicate'])
      const log = await runDeltas(f, result.actionId)
      expect(log.map((d) => [d.targetId, d.op, d.source, d.entryId])).toEqual([
        [STRANGER, 'update', 'chapter_close', endEntryId(f)],
      ])
      expect(calls[0]).toMatchObject({
        result: 'ok',
        rows: [
          { table: 'entities', id: STRANGER, name: 'the hooded stranger' },
          { table: 'entities', id: TOBIN, name: 'Tobin' },
        ],
        values: { nameCollisionPartnerId: 'Tobin' },
      })
    },
  )

  it.each([
    { order: 'Tobin first', input: { id: 'c1', partner: 'c2' } },
    { order: 'the stranger first', input: { id: 'c2', partner: 'c1' } },
  ])(
    "refuses a pair both of whose rows' live flags name other rows, writing nothing, $order",
    async ({ input }) => {
      await seedRow(f, { id: CLERK, kind: 'character', name: 'the toll clerk' })
      await seedRow(f, { id: WREN, kind: 'character', name: 'Wren' })
      await seedRow(f, {
        id: TOBIN,
        kind: 'character',
        name: 'Tobin',
        flag: { partnerId: CLERK, reason: 'duplicate' },
      })
      await seedRow(f, {
        id: STRANGER,
        kind: 'character',
        name: 'the hooded stranger',
        flag: { partnerId: WREN, reason: 'duplicate' },
      })

      const { result, answers } = await dispatchScripted(f, [flagCall(input)], { shown: SHOWN })

      expect(outputs(answers)).toEqual([
        {
          result: 'rejected',
          reason: 'already-flagged',
          note: 'Each row already holds a flag naming another row, and a row holds one flag: leave this pair for the user.',
        },
      ])
      expect(await runDeltas(f, result.actionId)).toEqual([])
      expect(flagOf(await storedEntity(f, TOBIN))).toEqual([1, CLERK, 'duplicate'])
      expect(flagOf(await storedEntity(f, STRANGER))).toEqual([1, WREN, 'duplicate'])
    },
  )

  it('flags the row named first over a dormant flag of its own, which counts as none', async () => {
    // Tobin's name-taken flag on Wren no longer holds: the two share no name.
    await seedRow(f, { id: WREN, kind: 'character', name: 'Wren' })
    await seedRow(f, {
      id: TOBIN,
      kind: 'character',
      name: 'Tobin',
      flag: { partnerId: WREN, reason: 'name-taken' },
    })
    await seedRow(f, { id: STRANGER, kind: 'character', name: 'the hooded stranger' })

    const { answers } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

    expect(outputs(answers)).toEqual([{ result: 'ok' }])
    expect(flagOf(await storedEntity(f, TOBIN))).toEqual([1, STRANGER, 'duplicate'])
    expect(flagOf(await storedEntity(f, STRANGER))).toEqual([0, null, null])
  })

  it("flags the stranger when a later turn gave Tobin a flag on a third row, Tobin's untouched", async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })
    await seedRow(f, { id: STRANGER, kind: 'character', name: 'the hooded stranger' })
    await seedRow(f, { id: NAMESAKE, kind: 'character', name: 'Tobin' })
    await write(
      f,
      {
        kind: 'raiseCollisionFlag',
        source: 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          id: TOBIN,
          partnerId: NAMESAKE,
          reason: 'name-taken',
          proseEntryId: laterReplyId(f),
        },
      },
      'act_close_turn_5',
      laterReplyId(f),
    )

    const { result, answers, calls } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

    expect(outputs(answers)).toEqual([{ result: 'ok' }])
    expect(flagOf(await storedEntity(f, STRANGER))).toEqual([1, TOBIN, 'duplicate'])
    expect(flagOf(await storedEntity(f, TOBIN))).toEqual([1, NAMESAKE, 'name-taken'])
    const log = await runDeltas(f, result.actionId)
    expect(log.map((d) => [d.targetId, d.op])).toEqual([[STRANGER, 'update']])
    expect(calls[0]).toMatchObject({
      result: 'ok',
      rows: [
        { table: 'entities', id: STRANGER, name: 'the hooded stranger' },
        { table: 'entities', id: TOBIN, name: 'Tobin' },
      ],
    })
  })

  it("skips the stranger's row when a later turn wrote its flag, Tobin's flag naming a third row", async () => {
    await seedRow(f, { id: CLERK, kind: 'character', name: 'the toll clerk' })
    await seedRow(f, { id: WREN, kind: 'character', name: 'Wren' })
    await seedRow(f, {
      id: TOBIN,
      kind: 'character',
      name: 'Tobin',
      flag: { partnerId: CLERK, reason: 'duplicate' },
    })
    await seedRow(f, {
      id: STRANGER,
      kind: 'character',
      name: 'the hooded stranger',
      flag: { partnerId: WREN, reason: 'duplicate' },
    })
    // A later turn clears the stranger's flag: free now, but that turn's write wins.
    await write(
      f,
      {
        kind: 'updateEntity',
        source: 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          id: STRANGER,
          patch: { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
        },
      },
      'act_close_turn_5',
      laterReplyId(f),
    )

    const { result, answers, calls } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

    expect(outputs(answers)).toEqual([
      { result: 'skipped', reason: CLOSE_REASON.laterTurn, note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect(calls[0]).toMatchObject({
      rows: [expect.objectContaining({ id: STRANGER }), expect.objectContaining({ id: TOBIN })],
    })
    expect(flagOf(await storedEntity(f, STRANGER))).toEqual([0, null, null])
  })

  it.each([
    { held: 'the row named first', holder: TOBIN, partner: STRANGER },
    { held: 'the partner', holder: STRANGER, partner: TOBIN },
  ])(
    'refuses a pair the user kept apart after the cited turns, the flag held by $held',
    async ({ holder, partner }) => {
      await seedRow(f, {
        id: TOBIN,
        kind: 'character',
        name: 'Tobin',
        flag: holder === TOBIN ? { partnerId: partner, reason: 'duplicate' } : undefined,
      })
      await seedRow(f, {
        id: STRANGER,
        kind: 'character',
        name: 'the hooded stranger',
        flag: holder === STRANGER ? { partnerId: partner, reason: 'duplicate' } : undefined,
      })
      await keepPair(f, holder, partner)

      const { result, answers } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

      // Not skipped: the user's clear answers the question, whenever it came.
      expect(outputs(answers)).toEqual([
        {
          result: 'rejected',
          reason: 'pair-resolved',
          note: 'The user already kept these two rows apart: do not flag them again.',
        },
      ])
      expect(await runDeltas(f, result.actionId)).toEqual([])
    },
  )

  it('refuses a pair the user kept apart before the cited turn', async () => {
    // Two turns (positions 1-5), the Keep, then the turn the call cites: the Keep is older prose's.
    f = await openCloseFixture({ turns: 2 })
    await seedRow(f, {
      id: TOBIN,
      kind: 'character',
      name: 'Tobin',
      flag: { partnerId: STRANGER, reason: 'duplicate' },
    })
    await seedRow(f, { id: STRANGER, kind: 'character', name: 'the hooded stranger' })
    await keepPair(f, TOBIN, STRANGER)
    await appendTurnEntry(f, {
      id: 'entry_late_006',
      position: 6,
      kind: 'user_action',
      content: 'I ask who keeps the far bank.',
    })
    await appendTurnEntry(f, {
      id: 'entry_late_007',
      position: 7,
      kind: 'ai_reply',
      content: 'Tobin pulls his hood low and says nothing.',
    })

    const { result, answers } = await dispatchScripted(f, [flagCall()], {
      shown: SHOWN,
      endEntryId: 'entry_late_007',
      taskEntryIds: [...f.entries.map((entry) => entry.id), 'entry_late_006', 'entry_late_007'],
    })

    expect(outputs(answers)).toEqual([
      {
        result: 'rejected',
        reason: 'pair-resolved',
        note: 'The user already kept these two rows apart: do not flag them again.',
      },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it("tells the model to resend when the partner's flag came to name the row after the plan read", async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })
    // The stranger's keyword names Tobin, so the `alike` flag it takes mid-call is live.
    await seedRow(f, {
      id: STRANGER,
      kind: 'character',
      name: 'the hooded stranger',
      keywords: ['tobin'],
    })

    const { result, answers } = await dispatchScripted(
      f,
      [{ toolName: 'flag_duplicate_raced', input: { id: 'c1', partner: 'c2', ...cite() } }],
      { shown: SHOWN },
    )

    expect(outputs(answers)).toEqual([
      {
        result: 'rejected',
        reason: 'flag-held-by-partner',
        note: 'The other row already holds a flag naming this one: send the call again to mark that flag as the same.',
      },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect(flagOf(await storedEntity(f, TOBIN))).toEqual([0, null, null])
  })

  it("skips a row whose flag a later turn wrote, before the handler reads that turn's flag", async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })
    // The stranger's own flag holds too, so the write stays on Tobin's row.
    await seedRow(f, { id: WREN, kind: 'character', name: 'Wren' })
    await seedRow(f, {
      id: STRANGER,
      kind: 'character',
      name: 'the hooded stranger',
      flag: { partnerId: WREN, reason: 'duplicate' },
    })
    await seedRow(f, { id: NAMESAKE, kind: 'character', name: 'Tobin' })
    await write(
      f,
      {
        kind: 'raiseCollisionFlag',
        source: 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          id: TOBIN,
          partnerId: NAMESAKE,
          reason: 'name-taken',
          proseEntryId: laterReplyId(f),
        },
      },
      'act_close_turn_5',
      laterReplyId(f),
    )

    const { result, answers } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

    // With no precedence check here the handler would answer already-flagged, rejected.
    expect(outputs(answers)).toEqual([
      { result: 'skipped', reason: CLOSE_REASON.laterTurn, note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('skips a row whose flag the user wrote after the cited turns, over another pair', async () => {
    await seedRow(f, { id: CLERK, kind: 'character', name: 'the toll clerk' })
    await seedRow(f, {
      id: TOBIN,
      kind: 'character',
      name: 'Tobin',
      flag: { partnerId: CLERK, reason: 'duplicate' },
    })
    await seedRow(f, { id: STRANGER, kind: 'character', name: 'the hooded stranger' })
    await keepPair(f, TOBIN, CLERK)

    const { result, answers } = await dispatchScripted(f, [flagCall()], { shown: SHOWN })

    expect(outputs(answers)).toEqual([
      { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('skips a row whose flag the user wrote after the cited turn, though before E', async () => {
    f = await openCloseFixture({ turns: 2 })
    await seedRow(f, { id: CLERK, kind: 'character', name: 'the toll clerk' })
    await seedRow(f, {
      id: TOBIN,
      kind: 'character',
      name: 'Tobin',
      flag: { partnerId: CLERK, reason: 'duplicate' },
    })
    await seedRow(f, { id: STRANGER, kind: 'character', name: 'the hooded stranger' })
    await keepPair(f, TOBIN, CLERK)
    const late = await appendLateTurns(f)

    const { result, answers } = await dispatchScripted(f, [flagCall(cite(['t5']))], {
      shown: SHOWN,
      ...late,
    })

    expect(outputs(answers)).toEqual([
      { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect(flagOf(await storedEntity(f, TOBIN))).toEqual([0, null, null])
  })

  it('refuses the same row twice', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })

    const { result, answers, calls } = await dispatchScripted(f, [flagCall({ partner: 'c1' })], {
      shown: SHOWN,
    })

    expect(outputs(answers)).toEqual([
      { result: 'rejected', reason: 'partner-is-self', note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect(calls[0]!.rows).toEqual([{ table: 'entities', id: TOBIN, name: 'Tobin' }])
  })

  it('refuses two rows of different kinds', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })
    await seedRow(f, { id: LANTERN, kind: 'item', name: 'Lantern' })

    const { result, answers } = await dispatchScripted(f, [flagCall({ partner: 'i1' })], {
      shown: [
        { id: TOBIN, name: 'Tobin' },
        { id: LANTERN, name: 'Lantern' },
      ],
    })

    expect(outputs(answers)).toEqual([
      { result: 'rejected', reason: 'partner-not-of-kind', note: expect.any(String) },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('refuses a gone partner as row-gone, naming it as shown and keeping the proposed partner', async () => {
    await seedRow(f, { id: TOBIN, kind: 'character', name: 'Tobin' })

    const { answers, calls } = await dispatchScripted(f, [flagCall()], {
      shown: [
        { id: TOBIN, name: 'Tobin' },
        { id: GONE, name: 'Ansel' },
      ],
    })

    expect(outputs(answers)).toEqual([
      { result: 'rejected', reason: CLOSE_REASON.rowGone, note: expect.any(String) },
    ])
    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      rows: [
        { table: 'entities', id: TOBIN, name: 'Tobin' },
        { table: 'entities', id: GONE, name: 'Ansel' },
      ],
      values: { nameCollisionPartnerId: 'Ansel' },
    })
  })
})
