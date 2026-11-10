import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { loadOpenStory } from '@/lib/actions/stories/operational'
import { undoLastAction } from '@/lib/actions/story-entries/undo'
import {
  USER_EDITED_SINCE_PROSE,
  type DeltaSource,
  type GroupOutcome,
  type GuardRow,
} from '@/lib/actions/types'
import {
  branches,
  deltas,
  emptyEntityState,
  entities,
  happenings,
  storyEntries,
  type Entity,
  type EntityState,
  type Happening,
  type NewEntity,
} from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { createReadSet } from './common-checks'
import { dispatchToolCall, type DispatchContext } from './dispatch'
import { CloseLedgerWriter } from './ledger'
import { turnInTextReason } from './text-checks'
import { assertReplaySafe, type CloseTool } from './tool'
import {
  markCommonKnowledgeTool,
  setKeywordsTool,
  updateItemTool,
  updatePlaceTool,
} from './upkeep-tools'
import { CLOSE_REASON } from './verdict'
import { expectRan } from '../../__tests__/harness'
import { definePipeline } from '../../authoring/define'
import { getPipelineSafe } from '../../authoring/registry'
import { runPipeline } from '../../runtime/orchestrator'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, TxResult } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeIdsOf, seedCloseLedger } from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

// ---- Harness: the close's ids and ledger, the shown rows read, the scripted calls dispatched. ----

const KIND = 'close-upkeep-tools-test'

const UPKEEP_TOOLS: Readonly<Record<string, CloseTool>> = {
  update_place: updatePlaceTool,
  update_item: updateItemTool,
  set_keywords: setKeywordsTool,
  mark_common_knowledge: markCommonKnowledgeTool,
}

/** The chapter: the opening to the third reply, t1…t7. E is that reply. */
const taskEntryIdsOf = (fx: CloseFixture): string[] => fx.entries.slice(0, 7).map(({ id }) => id)
const endEntryIdOf = (fx: CloseFixture): string => fx.entries[6]!.id
/** The fifth reply: past E, under the fixture's act_close_turn_5. */
const laterReplyIdOf = (fx: CloseFixture): string => fx.replyIds[4]!

type ShownRow = { table: 'entities' | 'happenings'; id: string; name: string }
type ToolCall = { toolName: string; input: Record<string, unknown> }
type CallsRun = { result: TxResult; answers: unknown[]; calls: CloseLedger['calls'] }
type TaskTurns = { endEntryId: string; taskEntryIds: readonly string[] }
type StagedRun = TaskTurns & {
  fx: CloseFixture
  shown: readonly ShownRow[]
  calls: readonly ToolCall[]
  answers: unknown[]
  ledger?: CloseLedger
}

let staged: StagedRun | undefined

async function* upkeepCallsPhase(
  phase: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const run = staged
  if (run === undefined) throw new Error('upkeepCallsPhase: no run staged')
  const { taskEntryIds } = run
  const ids = closeIdsOf(phase.intermediates)
  ids.showTurns(taskEntryIds)
  for (const { id, name } of run.shown) ids.show(id, name)
  const ledger = seedCloseLedger(phase.intermediates)
  const writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id), phase.actionId)
  const readSet = createReadSet()
  readSet.add(run.shown.map(({ table, id }): GuardRow => ({ table, id })))
  const ctx: DispatchContext = {
    db: phase.db,
    branchId: phase.branchId,
    endEntryId: run.endEntryId,
    task: 'upkeep',
    part: 1,
    ids,
    readFields: {},
    survivorOf: (table, id) => writer.survivorOf(table, id),
    landedCalls: (tool) => writer.landedCalls(tool),
    phase,
    taskEntryIds,
    readSet,
    ledger: writer,
  }
  for (const [index, { toolName, input }] of run.calls.entries()) {
    const tool = UPKEEP_TOOLS[toolName]
    if (tool === undefined) throw new Error(`no upkeep tool ${toolName}`)
    const answer = yield* dispatchToolCall(
      { toolCallId: `call_${index + 1}`, toolName, input },
      tool,
      ctx,
    )
    run.answers.push(answer.output)
  }
  run.ledger = ledger
  return { status: 'completed' }
}

/**
 * Runs `calls` in order through dispatch, in one close-like run, `shown` shown and read in order;
 * the task's turns are the chapter's unless `turns` names others.
 */
async function runUpkeepCalls(
  fx: CloseFixture,
  shown: readonly ShownRow[],
  calls: readonly ToolCall[],
  turns: TaskTurns = { endEntryId: endEntryIdOf(fx), taskEntryIds: taskEntryIdsOf(fx) },
): Promise<CallsRun> {
  if (getPipelineSafe(KIND) === undefined)
    definePipeline({
      kind: KIND,
      phases: [{ name: 'agent', run: upkeepCallsPhase }],
      affordance: 'invisible',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    })
  const run: StagedRun = { ...turns, fx, shown, calls, answers: [] }
  staged = run
  try {
    const result = expectRan(
      await runPipeline(KIND, {
        storyId: fx.storyId,
        branchId: fx.branchId,
        db: fx.ctx.db,
        runInTransaction: fx.ctx.runInTransaction,
      }),
    )
    if (result.outcome !== 'completed')
      throw new Error(`the run ${result.outcome}: ${JSON.stringify(result.error)}`)
    if (run.ledger === undefined) throw new Error('the phase never ran')
    return { result, answers: run.answers, calls: run.ledger.calls }
  } finally {
    staged = undefined
  }
}

const cite = (turns: readonly string[] = ['t7'], why = 'The turns show it at the landing.') => ({
  turns: [...turns],
  why,
})

function runDeltas(fx: CloseFixture, actionId: string) {
  return fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(asc(deltas.logPosition))
}

async function storedEntity(fx: CloseFixture, id: string): Promise<Entity> {
  const [found] = await fx.ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, fx.branchId), eq(entities.id, id)))
  if (found === undefined) throw new Error(`no entity ${id}`)
  return found
}

type SeedSpec = {
  id: string
  kind: NewEntity['kind']
  name: string
  description?: string | null
  injectionMode?: NewEntity['injectionMode']
  keywords?: string[]
  /** Merged over the kind's empty state. */
  state?: Readonly<Record<string, unknown>>
}

/** A row a pass created before the chapter: unanchored, under an action no turn owns. */
async function seedEntity(fx: CloseFixture, spec: SeedSpec): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: spec.id,
            branchId: fx.branchId,
            kind: spec.kind,
            name: spec.name,
            description: spec.description ?? null,
            status: 'active',
            injectionMode: spec.injectionMode ?? 'auto',
            keywords: spec.keywords ?? [],
            state: { ...emptyEntityState(spec.kind), ...spec.state } as EntityState,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      actionId: 'act_seed_world',
      branchId: fx.branchId,
      entryId: null,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seeding ${spec.name} refused: ${result.reason}`)
}

type Editor = 'user' | 'later-turn'

// user: after every turn's prose, unanchored. later-turn: anchored past E, a turn's own source.
const EDITORS: Readonly<Record<Editor, { source: DeltaSource; actionId: string; past: boolean }>> =
  {
    user: { source: 'user_edit', actionId: 'act_user_edit', past: false },
    'later-turn': { source: 'per_turn_classifier', actionId: 'act_close_turn_5', past: true },
  }

type EntityEdit = {
  description?: string
  keywords?: string[]
  status?: Entity['status']
  retiredReason?: string | null
  /** Merged over the stored state, as the World editor and a pass write the whole state. */
  state?: Readonly<Record<string, unknown>>
}

async function editEntity(
  fx: CloseFixture,
  id: string,
  who: Editor,
  edit: EntityEdit,
): Promise<void> {
  const current = await storedEntity(fx, id)
  const editor = EDITORS[who]
  const { state, ...columns } = edit
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'updateEntity',
        source: editor.source,
        payload: {
          branchId: fx.branchId,
          id,
          patch: {
            ...columns,
            ...(state === undefined
              ? {}
              : {
                  state: {
                    ...(current.state ?? emptyEntityState(current.kind)),
                    ...state,
                  } as EntityState,
                }),
          },
        },
      },
      actionId: editor.actionId,
      branchId: fx.branchId,
      entryId: editor.past ? laterReplyIdOf(fx) : null,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${who} edit of ${id} refused: ${result.reason}`)
}

// The tail and the scene source are both the branch's last reply; its location is the story's.
async function setStoryPlace(fx: CloseFixture, placeId: string): Promise<void> {
  const where = and(
    eq(storyEntries.branchId, fx.branchId),
    eq(storyEntries.id, fx.entries.at(-1)!.id),
  )
  const [row] = await fx.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  if (!row?.metadata) throw new Error('setStoryPlace: the last entry has no metadata')
  await fx.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row.metadata, currentLocationId: placeId } })
    .where(where)
}

const FORK = 'br_fork'

/** A branch forked at E: a row written only there is no row on the close's branch. */
async function addFork(fx: CloseFixture): Promise<void> {
  await fx.ctx.db.insert(branches).values({
    id: FORK,
    storyId: fx.storyId,
    parentBranchId: fx.branchId,
    forkEntryId: endEntryIdOf(fx),
    name: 'fork',
    createdAt: 2,
  })
}

/** A turn written after the fixture's, as the fixture writes one: the reply anchored on itself. */
async function appendTurnEntry(
  fx: CloseFixture,
  entry: { id: string; position: number; kind: 'user_action' | 'ai_reply'; content: string },
): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createStoryEntry',
        source: entry.kind === 'user_action' ? 'user_edit' : 'ai_classifier',
        payload: {
          entry: {
            ...entry,
            branchId: fx.branchId,
            chapterId: null,
            metadata: {
              sceneEntities: [],
              currentLocationId: null,
              worldTime: entry.position * 60,
            },
            createdAt: 1_767_225_600_000 + entry.position,
          },
        },
      },
      actionId: `act_late_turn_${entry.position}`,
      branchId: fx.branchId,
      entryId: entry.kind === 'ai_reply' ? entry.id : null,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`appending ${entry.id} refused: ${result.reason}`)
}

/** On a two-turn fixture (t1–t5): appends t6, t7 (E), so a write before them lands before E. */
async function appendLateTurns(fx: CloseFixture): Promise<TaskTurns> {
  await appendTurnEntry(fx, {
    id: 'entry_late_006',
    position: 6,
    kind: 'user_action',
    content: 'I ask who keeps the far bank.',
  })
  await appendTurnEntry(fx, {
    id: 'entry_late_007',
    position: 7,
    kind: 'ai_reply',
    content: 'Tobin pulls his hood low and says nothing.',
  })
  return {
    endEntryId: 'entry_late_007',
    taskEntryIds: [...fx.entries.map((entry) => entry.id), 'entry_late_006', 'entry_late_007'],
  }
}

afterEach(() => {
  resetAllStores()
})

// ---- The world: places, an item and a character, shown l1…l8, i1, c1 in this order. ----

const place = (n: number): string => `loc_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const QUAY = place(1)
const HARROW = place(2)
const OLD_KEEP = place(3)
const YARD = place(4)
const CELLAR = place(5)
const MARSH = place(6)
const LANDING = place(7)
const VARN = place(8)
const SATCHEL = 'item_00000000-0000-4000-8000-000000000009'
const TOBIN = 'char_00000000-0000-4000-8000-000000000010'

const WORLD_SHOWN: readonly ShownRow[] = [
  { table: 'entities', id: QUAY, name: 'The quay' },
  { table: 'entities', id: HARROW, name: 'Harrow' },
  { table: 'entities', id: OLD_KEEP, name: 'The old keep' },
  { table: 'entities', id: YARD, name: 'The keep yard' },
  { table: 'entities', id: CELLAR, name: 'The cellar' },
  { table: 'entities', id: MARSH, name: 'The marsh' },
  { table: 'entities', id: LANDING, name: 'The landing' },
  { table: 'entities', id: VARN, name: 'Varn' },
  { table: 'entities', id: SATCHEL, name: 'satchel' },
  { table: 'entities', id: TOBIN, name: 'Tobin' },
]

const QUAY_DESCRIPTION = 'Stone steps down to the river.'

// Quay (top level, condition); Harrow; old keep (retired after the keep yard was placed in it);
// cellar in the quay; marsh disabled; landing (the story's place); Varn unplaced; satchel; Tobin.
async function seedWorld(fx: CloseFixture): Promise<void> {
  await seedEntity(fx, {
    id: QUAY,
    kind: 'location',
    name: 'The quay',
    description: QUAY_DESCRIPTION,
    state: { condition: 'Slick with rain' },
  })
  await seedEntity(fx, { id: HARROW, kind: 'location', name: 'Harrow' })
  await seedEntity(fx, { id: OLD_KEEP, kind: 'location', name: 'The old keep' })
  await seedEntity(fx, {
    id: YARD,
    kind: 'location',
    name: 'The keep yard',
    state: { parent_location_id: OLD_KEEP },
  })
  await editEntity(fx, OLD_KEEP, 'user', { status: 'retired', retiredReason: 'Burned down.' })
  await seedEntity(fx, {
    id: CELLAR,
    kind: 'location',
    name: 'The cellar',
    state: { parent_location_id: QUAY },
  })
  await seedEntity(fx, {
    id: MARSH,
    kind: 'location',
    name: 'The marsh',
    injectionMode: 'disabled',
  })
  await seedEntity(fx, { id: LANDING, kind: 'location', name: 'The landing' })
  await seedEntity(fx, { id: VARN, kind: 'location', name: 'Varn', state: { unplaced: true } })
  await seedEntity(fx, {
    id: SATCHEL,
    kind: 'item',
    name: 'satchel',
    description: 'A courier satchel.',
    state: { condition: 'Wet through' },
  })
  await seedEntity(fx, { id: TOBIN, kind: 'character', name: 'Tobin' })
  await setStoryPlace(fx, LANDING)
}

// ---- update_place and update_item ----

describe('update_place and update_item: the tools', () => {
  it('replay as sent, every field but id optional', () => {
    assertReplaySafe(updatePlaceTool.schema, [
      { id: 'l1', turns: ['t1'], why: 'It floods.' },
      {
        id: 'l1',
        condition: 'Flooded',
        description: 'Stone steps under water.',
        parent: 'l2',
        turns: ['t1', 't2'],
        why: 'It floods.',
      },
      { id: 'l1', top: true, turns: ['t3'], why: 'Nothing holds it.' },
      { id: 'l1', top: false, condition: '', turns: ['t3'], why: 'It floods.' },
    ])
    assertReplaySafe(updateItemTool.schema, [
      { id: 'i1', turns: ['t1'], why: 'It tears.' },
      {
        id: 'i1',
        condition: 'Torn',
        description: 'A satchel.',
        turns: ['t1'],
        why: 'It tears.',
      },
    ])
  })

  it("take a place and an item under canon's names, a place's parent as any entity handle", () => {
    expect(updatePlaceTool).toMatchObject({
      kind: 'write',
      name: 'update_place',
      ids: {
        id: { shape: 'single', prefixes: ['loc_'] },
        parent: { shape: 'single', prefixes: ['char_', 'loc_', 'item_', 'fact_'] },
      },
    })
    expect(updateItemTool).toMatchObject({
      kind: 'write',
      name: 'update_item',
      ids: { id: { shape: 'single', prefixes: ['item_'] } },
    })
  })
})

describe('update_place', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
    await seedWorld(f)
  })

  it('lands condition, a parent and a description as one updateEntity on E, the parent clearing unplaced, and one CTRL-Z reverses it', async () => {
    const { result, answers, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      {
        toolName: 'update_place',
        input: {
          id: 'l8',
          condition: 'Half under water',
          parent: 'l2',
          description: 'A hamlet on stilts.',
          ...cite(),
        },
      },
    ])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls).toEqual([
      {
        task: 'upkeep',
        part: 1,
        tool: 'update_place',
        rows: [{ table: 'entities', id: VARN, name: 'Varn' }],
        why: 'The turns show it at the landing.',
        turns: [endEntryIdOf(f)],
        result: 'ok',
        values: {
          'state.condition': 'Half under water',
          description: 'A hamlet on stilts.',
          'state.parent_location_id': 'Harrow',
        },
      },
    ])
    const written = await runDeltas(f, result.actionId)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      targetTable: 'entities',
      targetId: VARN,
      source: 'chapter_close',
      entryId: endEntryIdOf(f),
    })
    const varn = await storedEntity(f, VARN)
    expect(varn.description).toBe('A hamlet on stilts.')
    expect(varn.state).toEqual({ parent_location_id: HARROW, condition: 'Half under water' })
    expect(varn.state).not.toHaveProperty('unplaced')

    expect(await undoLastAction(f.branchId, f.ctx)).toEqual({ status: 'ok' })
    const undone = await storedEntity(f, VARN)
    expect(undone.description).toBeNull()
    expect(undone.state).toEqual({ parent_location_id: null, unplaced: true })
  })

  it('skips condition a user wrote after the cited turn, naming it, while the description lands', async () => {
    await editEntity(f, QUAY, 'user', { state: { condition: 'Swept clean' } })

    const { answers, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      {
        toolName: 'update_place',
        input: {
          id: 'l1',
          condition: 'Flooded',
          description: 'Stone steps, now under water.',
          ...cite(),
        },
      },
    ])

    expect(calls[0]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.condition', reason: USER_EDITED_SINCE_PROSE }],
      values: { 'state.condition': 'Flooded', description: 'Stone steps, now under water.' },
    })
    expect(answers[0]).toMatchObject({
      result: 'ok',
      notWritten: [{ field: 'state.condition', row: 'l1', reason: USER_EDITED_SINCE_PROSE }],
    })
    const quay = await storedEntity(f, QUAY)
    expect(quay.description).toBe('Stone steps, now under water.')
    expect(quay.state).toMatchObject({ condition: 'Swept clean' })
  })

  it('skips a call whose only field a later turn wrote, writing nothing', async () => {
    await editEntity(f, QUAY, 'later-turn', { state: { condition: 'Crowded with boats' } })

    const { result, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l1', condition: 'Flooded', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'skipped',
      reason: CLOSE_REASON.laterTurn,
      values: { 'state.condition': 'Flooded' },
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, QUAY)).state).toMatchObject({ condition: 'Crowded with boats' })
  })

  it('answers ok writing nothing when every field restates the row, a top-level mark included', async () => {
    const { result, answers, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      {
        toolName: 'update_place',
        input: {
          id: 'l1',
          condition: 'Slick with rain ',
          description: QUAY_DESCRIPTION,
          top: true,
          ...cite(),
        },
      },
    ])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('answers ok, not skipped, for a text a later turn wrote and the call restates', async () => {
    await editEntity(f, QUAY, 'later-turn', { state: { condition: 'Crowded with boats' } })

    const { result, answers, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      {
        toolName: 'update_place',
        input: { id: 'l1', condition: 'Crowded with boats ', ...cite() },
      },
    ])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  // C11: a refused placement drops alone; the condition beside it lands.
  it.each([
    {
      name: 'a parent that is no place',
      id: 'l1',
      row: QUAY,
      placement: { parent: 'c1' },
      path: 'state.parent_location_id',
      reason: 'parent-not-a-place',
      value: 'Tobin',
    },
    {
      name: 'a retired parent',
      id: 'l1',
      row: QUAY,
      placement: { parent: 'l3' },
      path: 'state.parent_location_id',
      reason: 'retired-parent',
      value: 'The old keep',
    },
    {
      name: 'a parent inside the place',
      id: 'l1',
      row: QUAY,
      placement: { parent: 'l5' },
      path: 'state.parent_location_id',
      reason: 'parent-cycle',
      value: 'The cellar',
    },
    {
      name: 'top on a placed place',
      id: 'l5',
      row: CELLAR,
      placement: { top: true },
      path: 'state.unplaced',
      reason: 'not-unplaced',
      value: 'top level',
    },
    {
      name: 'a disabled parent around the story',
      id: 'l7',
      row: LANDING,
      placement: { parent: 'l6' },
      path: 'state.parent_location_id',
      reason: 'story-inside',
      value: 'The marsh',
    },
  ])(
    'refuses $name with its reason while the condition lands',
    async ({ id, row, placement, path, reason, value }) => {
      const before = await storedEntity(f, row)

      const { result, answers, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
        {
          toolName: 'update_place',
          input: { id, condition: 'Rain-soaked', ...placement, ...cite() },
        },
      ])

      expect(calls[0]).toMatchObject({
        result: 'ok',
        skippedFields: [{ field: path, reason }],
        values: { 'state.condition': 'Rain-soaked', [path]: value },
      })
      expect(answers[0]).toEqual({ result: 'ok', notWritten: [{ field: path, row: id, reason }] })
      expect(await runDeltas(f, result.actionId)).toHaveLength(1)
      const after = await storedEntity(f, row)
      expect(after.state).toEqual({ ...(before.state as object), condition: 'Rain-soaked' })
    },
  )

  it('lands the same disabled parent for a place that does not hold the story', async () => {
    const { calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l1', parent: 'l6', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'ok',
      values: { 'state.parent_location_id': 'The marsh' },
    })
    expect((await storedEntity(f, QUAY)).state).toMatchObject({ parent_location_id: MARSH })
  })

  it('refuses a placement sent alone, writing nothing', async () => {
    const { result, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l1', parent: 'l5', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: 'parent-cycle',
      values: { 'state.parent_location_id': 'The cellar' },
    })
    expect(calls[0]).not.toHaveProperty('skippedFields')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('marks an unplaced place top level, the review value naming the move', async () => {
    const { calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l8', top: true, ...cite() } },
    ])

    expect(calls[0]).toMatchObject({ result: 'ok', values: { 'state.unplaced': 'top level' } })
    expect((await storedEntity(f, VARN)).state).toEqual({ parent_location_id: null })
  })

  // placeLocation judges its rules before the user's edit: a refusal reads with its own reason.
  it('judges a placement by its rules before its precedence', async () => {
    await editEntity(f, QUAY, 'user', { state: { parent_location_id: HARROW } })

    const { calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      {
        toolName: 'update_place',
        input: { id: 'l1', condition: 'Rain-soaked', parent: 'l3', ...cite() },
      },
      {
        toolName: 'update_place',
        input: { id: 'l1', condition: 'Storm-lashed', parent: 'l6', ...cite() },
      },
    ])

    expect(calls[0]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.parent_location_id', reason: 'retired-parent' }],
    })
    expect(calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.parent_location_id', reason: USER_EDITED_SINCE_PROSE }],
    })
    expect((await storedEntity(f, QUAY)).state).toMatchObject({
      parent_location_id: HARROW,
      condition: 'Storm-lashed',
    })
  })

  it('answers ok writing nothing for a placement restated under a now-retired parent', async () => {
    const { result, answers, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l4', parent: 'l3', ...cite() } },
    ])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('refuses only a condition holding a turn handle, landing the description', async () => {
    const { calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      {
        toolName: 'update_place',
        input: {
          id: 'l1',
          condition: 'Flooded since t3',
          description: 'Stone steps under the flood.',
          ...cite(),
        },
      },
    ])

    expect(calls[0]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.condition', reason: turnInTextReason('t3') }],
    })
    const quay = await storedEntity(f, QUAY)
    expect(quay.description).toBe('Stone steps under the flood.')
    expect(quay.state).toMatchObject({ condition: 'Slick with rain' })
  })

  // C11: a protected field reads skipped, its handle never judged.
  it('skips a condition the user wrote after the cited turn though it holds a turn handle', async () => {
    await editEntity(f, QUAY, 'user', { state: { condition: 'Swept clean' } })

    const { result, answers, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l1', condition: 'Flooded since t3', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'skipped',
      reason: USER_EDITED_SINCE_PROSE,
      values: { 'state.condition': 'Flooded since t3' },
    })
    expect(answers[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, QUAY)).state).toMatchObject({ condition: 'Swept clean' })
  })

  it('refuses parent and top sent together, writing nothing', async () => {
    const { result, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l8', parent: 'l2', top: true, ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('not both'),
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('reads top: false as left out', async () => {
    const { calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l8', top: false, condition: 'Quiet', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({ result: 'ok', values: { 'state.condition': 'Quiet' } })
    expect(Object.keys(calls[0]!.values ?? {})).toEqual(['state.condition'])
    expect((await storedEntity(f, VARN)).state).toEqual({
      parent_location_id: null,
      unplaced: true,
      condition: 'Quiet',
    })
  })

  it('refuses a call whose every field is blank or left out', async () => {
    const { result, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      {
        toolName: 'update_place',
        input: { id: 'l1', condition: '  ', description: '', ...cite() },
      },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('blank or left out'),
    })
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('bounds a condition to 500 characters, as a pass does', async () => {
    const long = 'word '.repeat(140).trim()

    const { calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l1', condition: long, ...cite() } },
    ])

    expect(calls[0]).toMatchObject({ result: 'ok' })
    const stored = (await storedEntity(f, QUAY)).state as { condition?: string }
    expect(stored.condition?.length).toBeLessThanOrEqual(500)
    expect(stored.condition?.length).toBeGreaterThan(250)
    expect(long.startsWith(stored.condition ?? '')).toBe(true)
  })

  it('cuts a description at 1,200 characters, as a pass does', async () => {
    const { calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'l1', description: 'x'.repeat(1201), ...cite() } },
    ])

    expect(calls[0]).toMatchObject({ result: 'ok' })
    const stored = (await storedEntity(f, QUAY)).description
    expect(stored).toHaveLength(1200)
    expect(stored).toBe('x'.repeat(1200))
  })

  it('refuses an item sent as the place, writing nothing', async () => {
    const { result, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_place', input: { id: 'i1', condition: 'Torn', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: 'i1 in id is an item; id takes a place',
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })
})

describe('update_item', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
    await seedWorld(f)
  })

  it('lands condition and description as one updateEntity on E', async () => {
    const { result, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      {
        toolName: 'update_item',
        input: {
          id: 'i1',
          condition: 'Torn at the strap',
          description: 'A courier satchel, mended twice.',
          ...cite(),
        },
      },
    ])

    expect(calls[0]).toMatchObject({
      tool: 'update_item',
      result: 'ok',
      values: {
        'state.condition': 'Torn at the strap',
        description: 'A courier satchel, mended twice.',
      },
    })
    expect(await runDeltas(f, result.actionId)).toHaveLength(1)
    const satchel = await storedEntity(f, SATCHEL)
    expect(satchel.description).toBe('A courier satchel, mended twice.')
    expect(satchel.state).toEqual({ at_location_id: null, condition: 'Torn at the strap' })
  })

  it('skips condition a user wrote after the cited turn, while the description lands', async () => {
    await editEntity(f, SATCHEL, 'user', { state: { condition: 'Mended' } })

    const { calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      {
        toolName: 'update_item',
        input: { id: 'i1', condition: 'Torn', description: 'A satchel.', ...cite() },
      },
    ])

    expect(calls[0]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.condition', reason: USER_EDITED_SINCE_PROSE }],
    })
    expect((await storedEntity(f, SATCHEL)).state).toMatchObject({ condition: 'Mended' })
  })

  it('refuses an item that exists only on another branch as row-gone', async () => {
    const KNIFE = 'item_00000000-0000-4000-8000-000000000011'
    await addFork(f)
    await f.ctx.db.insert(entities).values({
      id: KNIFE,
      branchId: FORK,
      kind: 'item',
      name: 'knife',
      description: null,
      status: 'active',
      retiredReason: null,
      injectionMode: 'auto',
      state: emptyEntityState('item'),
      keywords: [],
      createdAt: 1,
      updatedAt: 1,
    })

    const { result, calls } = await runUpkeepCalls(
      f,
      [{ table: 'entities', id: KNIFE, name: 'knife' }],
      [{ toolName: 'update_item', input: { id: 'i1', condition: 'Notched', ...cite() } }],
    )

    expect(calls[0]).toMatchObject({ result: 'rejected', reason: CLOSE_REASON.rowGone })
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('refuses a place sent as the item, writing nothing', async () => {
    const { result, calls } = await runUpkeepCalls(f, WORLD_SHOWN, [
      { toolName: 'update_item', input: { id: 'l1', condition: 'Flooded', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: 'l1 in id is a place; id takes an item',
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })
})

// ---- set_keywords ----

/** Inserted with no delta, as the wizard and the default seed write a row; then the stores reopen. */
async function putWizardRow(
  fx: CloseFixture,
  row: { id: string; kind: Entity['kind']; name: string; keywords: string[] },
): Promise<void> {
  await fx.ctx.db.insert(entities).values({
    id: row.id,
    branchId: fx.branchId,
    kind: row.kind,
    name: row.name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    state: emptyEntityState(row.kind),
    keywords: row.keywords,
    createdAt: 1,
    updatedAt: 1,
  })
  const reopened = await loadOpenStory(fx.branchId, fx.ctx)
  if (reopened.status !== 'ok') throw new Error(`the story did not reopen: ${reopened.status}`)
}

/** A later turn's per-turn writer appending a term: anchored past E. */
async function laterTurnAppends(fx: CloseFixture, id: string, keywords: string[]): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'appendEntityKeywords',
        source: 'per_turn_classifier',
        payload: { branchId: fx.branchId, id, keywords, proseEntryId: null },
      },
      actionId: 'act_close_turn_5',
      branchId: fx.branchId,
      entryId: laterReplyIdOf(fx),
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`the later turn's append refused: ${result.reason}`)
}

const MILL = place(21)
const HARBOUR = place(22)
const TOWER = place(23)
const GATE = place(24)
const FERRY = 'item_00000000-0000-4000-8000-000000000025'
const OLD_TOBIN = 'char_00000000-0000-4000-8000-000000000026'

// l1…l4, i1, c1 in this order.
const KEYWORD_SHOWN: readonly ShownRow[] = [
  { table: 'entities', id: MILL, name: 'The mill' },
  { table: 'entities', id: HARBOUR, name: 'The harbour' },
  { table: 'entities', id: TOWER, name: 'The tower' },
  { table: 'entities', id: GATE, name: 'The gate' },
  { table: 'entities', id: FERRY, name: 'ferry token' },
  { table: 'entities', id: OLD_TOBIN, name: 'Tobin' },
]

// Mill: a pass's two terms. Harbour: pass 'quay', then user 'harbour'. Tower: wizard row, no create
// delta. Gate: pass 'north gate', then a user merge's union (user_edit updateEntity, kept row).
// Ferry token: pass's two terms, user removes 'crossing'. Tobin: pass term, later-turn append.
async function seedKeywordRows(fx: CloseFixture): Promise<void> {
  await seedEntity(fx, {
    id: MILL,
    kind: 'location',
    name: 'The mill',
    keywords: ['old mill', 'the miller'],
  })
  await seedEntity(fx, { id: HARBOUR, kind: 'location', name: 'The harbour', keywords: ['quay'] })
  await editEntity(fx, HARBOUR, 'user', { keywords: ['quay', 'harbour'] })
  await putWizardRow(fx, {
    id: TOWER,
    kind: 'location',
    name: 'The tower',
    keywords: ['the wizard tower'],
  })
  await seedEntity(fx, { id: GATE, kind: 'location', name: 'The gate', keywords: ['north gate'] })
  await editEntity(fx, GATE, 'user', { keywords: ['north gate', 'the gatehouse'] })
  await seedEntity(fx, {
    id: FERRY,
    kind: 'item',
    name: 'ferry token',
    keywords: ['ferry', 'crossing'],
  })
  await editEntity(fx, FERRY, 'user', { keywords: ['ferry'] })
  await seedEntity(fx, { id: OLD_TOBIN, kind: 'character', name: 'Tobin', keywords: ['old tobin'] })
  await laterTurnAppends(fx, OLD_TOBIN, ['the ferryman'])
}

describe('set_keywords and mark_common_knowledge: the tools', () => {
  it('replay as sent', () => {
    assertReplaySafe(setKeywordsTool.schema, [
      { id: 'l1', add: ['grain store'], turns: ['t1'], why: 'They call it so.' },
      { id: 'l1', add: [], remove: ['the miller'], turns: ['t1', 't2'], why: 'He left.' },
      { id: 'c1', turns: ['t3'], why: 'Nothing.' },
    ])
    assertReplaySafe(markCommonKnowledgeTool.schema, [
      { id: 'hp1', turns: ['t1'], why: 'The whole town talks of it.' },
    ])
  })

  it("take canon's names, any entity for keywords and a happening for the mark", () => {
    expect(setKeywordsTool).toMatchObject({
      kind: 'write',
      name: 'set_keywords',
      ids: { id: { shape: 'single', prefixes: ['char_', 'loc_', 'item_', 'fact_'] } },
    })
    expect(markCommonKnowledgeTool).toMatchObject({
      kind: 'write',
      name: 'mark_common_knowledge',
      ids: { id: { shape: 'single', prefixes: ['hap_'] } },
    })
  })

  it("tells the model it can't see a keyword's author", () => {
    expect(setKeywordsTool.schema.shape.remove.description).toBe(
      "Terms to remove: only a term that no longer fits. You can't see who added a term; removing one the user added is rejected.",
    )
    expect(setKeywordsTool.description).toContain(
      "Remove only a term that no longer fits. You can't see who added a term; removing one the user added is rejected, naming it.",
    )
    expect(setKeywordsTool.description).not.toContain('an AI added')
  })
})

describe('set_keywords', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
    await seedKeywordRows(f)
  })

  it("adds and removes in one setEntityKeywords delta on E, a pass's term going", async () => {
    const { result, answers, calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      {
        toolName: 'set_keywords',
        input: { id: 'l1', add: ['grain store'], remove: ['the miller'], ...cite() },
      },
    ])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls).toEqual([
      {
        task: 'upkeep',
        part: 1,
        tool: 'set_keywords',
        rows: [{ table: 'entities', id: MILL, name: 'The mill' }],
        why: 'The turns show it at the landing.',
        turns: [endEntryIdOf(f)],
        result: 'ok',
        values: { keywords: 'old mill, grain store' },
      },
    ])
    const written = await runDeltas(f, result.actionId)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      targetId: MILL,
      source: 'chapter_close',
      entryId: endEntryIdOf(f),
    })
    expect((await storedEntity(f, MILL)).keywords).toEqual(['old mill', 'grain store'])
  })

  // retrieval.md → Keywords schema: only a term an AI added can go; the add beside it waits too.
  it.each([
    { name: 'a term the user added', id: 'l2', row: HARBOUR, term: 'harbour' },
    {
      name: 'a wizard row term with no create delta',
      id: 'l3',
      row: TOWER,
      term: 'the wizard tower',
    },
    { name: "a user merge's unioned term", id: 'l4', row: GATE, term: 'the gatehouse' },
  ])('refuses removing $name, naming it and writing nothing', async ({ id, row, term }) => {
    const before = (await storedEntity(f, row)).keywords

    const { result, calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      { toolName: 'set_keywords', input: { id, add: ['landmark'], remove: [term], ...cite() } },
    ])

    expect(calls[0]).toMatchObject({ result: 'rejected', reason: `keyword-user-added: ${term}` })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, row)).keywords).toEqual(before)
  })

  it("keeps a term the user removed after the cited turn removed, while the call's other terms land", async () => {
    const { calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      {
        toolName: 'set_keywords',
        input: { id: 'i1', add: ['crossing', 'night ferry'], ...cite() },
      },
    ])

    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect((await storedEntity(f, FERRY)).keywords).toEqual(['ferry', 'night ferry'])
  })

  // The action judges a user's removal against the latest cited turn's prose, not E's.
  it('keeps a term the user removed after the cited turn though before E', async () => {
    f = await openCloseFixture({ turns: 2 })
    await seedEntity(f, {
      id: FERRY,
      kind: 'item',
      name: 'ferry token',
      keywords: ['ferry', 'crossing'],
    })
    await editEntity(f, FERRY, 'user', { keywords: ['ferry'] })
    const late = await appendLateTurns(f)

    const { calls } = await runUpkeepCalls(
      f,
      [{ table: 'entities', id: FERRY, name: 'ferry token' }],
      [
        {
          toolName: 'set_keywords',
          input: { id: 'i1', add: ['crossing', 'night ferry'], ...cite(['t5']) },
        },
      ],
      late,
    )

    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect((await storedEntity(f, FERRY)).keywords).toEqual(['ferry', 'night ferry'])
  })

  it('skips a list a later turn wrote, writing nothing', async () => {
    const { result, calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      { toolName: 'set_keywords', input: { id: 'c1', add: ['ferryman tobin'], ...cite() } },
    ])

    expect(calls[0]).toMatchObject({ result: 'skipped', reason: CLOSE_REASON.laterTurn })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, OLD_TOBIN)).keywords).toEqual(['old tobin', 'the ferryman'])
  })

  it('answers ok, not skipped, for a list a later turn wrote and the call restates', async () => {
    const { result, answers, calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      { toolName: 'set_keywords', input: { id: 'c1', add: ['The Ferryman'], ...cite() } },
    ])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('refuses a handle-holding add even when the list is already as asked', async () => {
    const SHELF = place(27)
    await seedEntity(f, { id: SHELF, kind: 'location', name: 'The shelf', keywords: ['c1'] })
    const shown = [...KEYWORD_SHOWN, { table: 'entities', id: SHELF, name: 'The shelf' } as const]

    const { result, calls } = await runUpkeepCalls(f, shown, [
      { toolName: 'set_keywords', input: { id: 'l5', add: ['c1'], ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('the keyword "c1" holds c1, an id'),
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  // A removal stores nothing, so a term a pass stored that reads as a handle can still go.
  it('removes a term a pass added that holds a short id', async () => {
    const SHELF = place(27)
    await seedEntity(f, {
      id: SHELF,
      kind: 'location',
      name: 'The shelf',
      keywords: ['c1', 'top shelf'],
    })
    const shown = [...KEYWORD_SHOWN, { table: 'entities', id: SHELF, name: 'The shelf' } as const]

    const { answers, calls } = await runUpkeepCalls(f, shown, [
      { toolName: 'set_keywords', input: { id: 'l5', remove: ['c1'], ...cite() } },
    ])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls[0]).toMatchObject({ result: 'ok', values: { keywords: 'top shelf' } })
    expect((await storedEntity(f, SHELF)).keywords).toEqual(['top shelf'])
  })

  it('skips a list a later turn wrote before refusing its terms', async () => {
    const { calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      { toolName: 'set_keywords', input: { id: 'c1', add: ['c1'], ...cite() } },
      { toolName: 'set_keywords', input: { id: 'c1', add: ['x'], remove: ['X'], ...cite() } },
    ])

    expect(calls[0]).toMatchObject({ result: 'skipped', reason: CLOSE_REASON.laterTurn })
    expect(calls[1]).toMatchObject({ result: 'skipped', reason: CLOSE_REASON.laterTurn })
  })

  it('answers ok writing nothing when every add is held and no removal names a held term', async () => {
    const { result, answers, calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      {
        toolName: 'set_keywords',
        input: { id: 'l1', add: ['Old Mill '], remove: ['millpond'], ...cite() },
      },
    ])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('refuses a term in both lists, matched by its normalized form, writing nothing', async () => {
    const { result, calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      {
        toolName: 'set_keywords',
        input: { id: 'l1', add: ['Gate'], remove: ['gate '], ...cite() },
      },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('"Gate" is in both add and remove'),
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it("refuses a term holding a short id, a row's or a turn's, writing nothing", async () => {
    const { result, calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      { toolName: 'set_keywords', input: { id: 'l1', add: ['c1'], ...cite() } },
      { toolName: 'set_keywords', input: { id: 'l1', add: ['the road from t3'], ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('the keyword "c1" holds c1, an id'),
    })
    expect(calls[1]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('the keyword "the road from t3" holds t3, an id'),
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('refuses a call with nothing to add or remove', async () => {
    const { calls } = await runUpkeepCalls(f, KEYWORD_SHOWN, [
      { toolName: 'set_keywords', input: { id: 'l1', add: ['  '], remove: [], ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: expect.stringContaining('both empty'),
    })
    expect(calls[0]).not.toHaveProperty('values')
  })
})

// ---- mark_common_knowledge ----

const hap = (n: number): string => `hap_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const FIGHT = hap(31)
const TOLL = hap(32)
const CROSSING = hap(33)
// Shown, never seeded: a row gone before the call.
const GONE_HAP = hap(34)
const SPREAD = hap(35)

// hp1…hp5 in this order.
const HAPPENING_SHOWN: readonly ShownRow[] = [
  { table: 'happenings', id: FIGHT, name: 'A fight at the inn' },
  { table: 'happenings', id: TOLL, name: 'The new toll' },
  { table: 'happenings', id: CROSSING, name: 'The night crossing' },
  { table: 'happenings', id: GONE_HAP, name: 'A lost rumour' },
  { table: 'happenings', id: SPREAD, name: 'The harvest news' },
]

async function seedHappening(
  fx: CloseFixture,
  row: { id: string; title: string; commonKnowledge: 0 | 1 },
): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createHappening',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: row.id,
            branchId: fx.branchId,
            title: row.title,
            occurredAtEntryId: fx.entries[4]!.id,
            commonKnowledge: row.commonKnowledge,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      actionId: 'act_seed_world',
      branchId: fx.branchId,
      entryId: null,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seeding ${row.title} refused: ${result.reason}`)
}

async function editHappening(
  fx: CloseFixture,
  id: string,
  who: Editor,
  patch: { commonKnowledge: 0 | 1 },
): Promise<void> {
  const editor = EDITORS[who]
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'updateHappening',
        source: editor.source,
        payload: { branchId: fx.branchId, id, patch, proseEntryId: null },
      },
      actionId: editor.actionId,
      branchId: fx.branchId,
      entryId: editor.past ? laterReplyIdOf(fx) : null,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${who} edit of ${id} refused: ${result.reason}`)
}

async function storedHappening(fx: CloseFixture, id: string): Promise<Happening> {
  const [found] = await fx.ctx.db
    .select()
    .from(happenings)
    .where(and(eq(happenings.branchId, fx.branchId), eq(happenings.id, id)))
  if (found === undefined) throw new Error(`no happening ${id}`)
  return found
}

describe('mark_common_knowledge', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
    await seedHappening(f, { id: FIGHT, title: 'A fight at the inn', commonKnowledge: 0 })
    await seedHappening(f, { id: TOLL, title: 'The new toll', commonKnowledge: 1 })
    await editHappening(f, TOLL, 'later-turn', { commonKnowledge: 0 })
    await seedHappening(f, { id: CROSSING, title: 'The night crossing', commonKnowledge: 1 })
    await editHappening(f, CROSSING, 'user', { commonKnowledge: 0 })
    await seedHappening(f, { id: SPREAD, title: 'The harvest news', commonKnowledge: 0 })
    await editHappening(f, SPREAD, 'later-turn', { commonKnowledge: 1 })
  })

  it('sets 1 through one updateHappening on E, and a repeat answers ok writing nothing', async () => {
    const { result, answers, calls } = await runUpkeepCalls(f, HAPPENING_SHOWN, [
      { toolName: 'mark_common_knowledge', input: { id: 'hp1', ...cite() } },
      { toolName: 'mark_common_knowledge', input: { id: 'hp1', ...cite() } },
    ])

    expect(answers).toEqual([{ result: 'ok' }, { result: 'ok' }])
    expect(calls[0]).toEqual({
      task: 'upkeep',
      part: 1,
      tool: 'mark_common_knowledge',
      rows: [{ table: 'happenings', id: FIGHT, name: 'A fight at the inn' }],
      why: 'The turns show it at the landing.',
      turns: [endEntryIdOf(f)],
      result: 'ok',
      values: { commonKnowledge: '1' },
    })
    expect(calls[1]).toMatchObject({ result: 'ok' })
    expect(calls[1]).not.toHaveProperty('values')
    const written = await runDeltas(f, result.actionId)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      targetTable: 'happenings',
      targetId: FIGHT,
      source: 'chapter_close',
      entryId: endEntryIdOf(f),
    })
    expect((await storedHappening(f, FIGHT)).commonKnowledge).toBe(1)
  })

  it('skips a happening whose mark a later turn wrote, writing nothing', async () => {
    const { result, calls } = await runUpkeepCalls(f, HAPPENING_SHOWN, [
      { toolName: 'mark_common_knowledge', input: { id: 'hp2', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'skipped',
      reason: CLOSE_REASON.laterTurn,
      values: { commonKnowledge: '1' },
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedHappening(f, TOLL)).commonKnowledge).toBe(0)
  })

  it('skips a mark the user cleared after the cited turn', async () => {
    const { result, calls } = await runUpkeepCalls(f, HAPPENING_SHOWN, [
      { toolName: 'mark_common_knowledge', input: { id: 'hp3', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedHappening(f, CROSSING)).commonKnowledge).toBe(0)
  })

  // The action judges the user's edit against the latest cited turn's prose, not E's.
  it('skips a mark the user cleared after the cited turn though before E', async () => {
    f = await openCloseFixture({ turns: 2 })
    await seedHappening(f, { id: CROSSING, title: 'The night crossing', commonKnowledge: 1 })
    await editHappening(f, CROSSING, 'user', { commonKnowledge: 0 })
    const late = await appendLateTurns(f)

    const { result, calls } = await runUpkeepCalls(
      f,
      [{ table: 'happenings', id: CROSSING, name: 'The night crossing' }],
      [{ toolName: 'mark_common_knowledge', input: { id: 'hp1', ...cite(['t5']) } }],
      late,
    )

    expect(calls[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedHappening(f, CROSSING)).commonKnowledge).toBe(0)
  })

  it('answers ok, not skipped, for a mark a later turn set to 1', async () => {
    const { result, answers, calls } = await runUpkeepCalls(f, HAPPENING_SHOWN, [
      { toolName: 'mark_common_knowledge', input: { id: 'hp5', ...cite() } },
    ])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('refuses a gone happening as row-gone', async () => {
    const { calls } = await runUpkeepCalls(f, HAPPENING_SHOWN, [
      { toolName: 'mark_common_knowledge', input: { id: 'hp4', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      values: { commonKnowledge: '1' },
    })
  })

  // Marked on the fork: a read off the branch would answer ok for a row this branch lacks.
  it('refuses a happening that exists only on another branch as row-gone', async () => {
    await addFork(f)
    await f.ctx.db.insert(happenings).values({
      id: GONE_HAP,
      branchId: FORK,
      title: 'A lost rumour',
      description: null,
      category: null,
      icon: null,
      temporal: null,
      occurredAtEntryId: null,
      commonKnowledge: 1,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    })

    const { result, calls } = await runUpkeepCalls(f, HAPPENING_SHOWN, [
      { toolName: 'mark_common_knowledge', input: { id: 'hp4', ...cite() } },
    ])

    expect(calls[0]).toMatchObject({ result: 'rejected', reason: CLOSE_REASON.rowGone })
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })
})
