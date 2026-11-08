import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import { readRowGuard } from '@/lib/actions/delta/row-guard'
import {
  USER_EDITED_SINCE_PROSE,
  type GroupOutcome,
  type GuardRow,
  type RowVerdicts,
} from '@/lib/actions/types'
import { deltas, emptyEntityState, entities, lore, type Entity, type EntityState } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { resetAllStores } from '@/lib/stores'

import { createReadSet } from './common-checks'
import { dispatchToolCall, type DispatchContext, type ToolAnswer } from './dispatch'
import { entityWriteAction, fieldVerdicts, restatedFields } from './entity-write'
import { CloseIds } from './ids'
import { CloseLedgerWriter } from './ledger'
import {
  readToolSchema,
  writeToolSchema,
  type CloseTool,
  type LostField,
  type ReadTool,
  type WriteContext,
  type WritePlan,
  type WriteTool,
} from './tool'
import { CLOSE_REASON, verdictOf } from './verdict'
import { expectRan } from '../../__tests__/harness'
import { definePipeline } from '../../authoring/define'
import { __resetRegistry } from '../../authoring/registry'
import { __resetBus, pipelineEventBus } from '../../runtime/event-bus'
import { runPipeline } from '../../runtime/orchestrator'
import type {
  PhaseContext,
  PhaseEmittedEvent,
  PhaseResult,
  PipelineEvent,
  TxResult,
} from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeIdsOf, seedCloseLedger } from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

// Substitutable ids must be real uuids: CloseIds.show allocates only those (lib/ids/prefixes.ts).
const WREN = 'char_00000000-0000-4000-8000-000000000001'
const GROUP_ACTION = 'act_close_group'
const TEST_CAP = 'over-test-cap'
const NO_SURVIVOR = { survivorOf: () => undefined }

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

const WREN_STATE: EntityState = deepFreeze({
  visual: { hair: 'black' },
  traits: ['patient'],
  drives: ['deliver the letter'],
  voice: 'soft',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
})

const CHARACTER: Entity = deepFreeze({
  id: WREN,
  branchId: 'br_close',
  kind: 'character',
  name: 'Wren',
  description: 'A courier.',
  status: 'active',
  retiredReason: null,
  injectionMode: 'auto',
  nameCollisionFlag: 0,
  nameCollisionPartnerId: null,
  nameCollisionReason: null,
  state: WREN_STATE,
  tags: [],
  keywords: [],
  priority: 0,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
})

let f: CloseFixture

afterEach(() => {
  resetAllStores()
})

// The chapter runs from the opening to the third reply (positions 1-7); E is that reply.
const endEntryId = (): string => f.entries[6]!.id
// The fifth reply (position 11): past E, under the fixture's act_close_turn_5.
const laterReplyId = (): string => f.replyIds[4]!

// Created unanchored under an action no turn owns, so it reads as neither a later turn's nor the user's.
async function seedCharacter(id: string, name: string): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id,
            branchId: f.branchId,
            kind: 'character',
            name,
            description: 'A courier.',
            status: 'active',
            injectionMode: 'auto',
            state: WREN_STATE,
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
  if (result.status !== 'ok') throw new Error(`seeding ${name} refused: ${result.reason}`)
}

async function row(id = WREN): Promise<Entity> {
  const [found] = await f.ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, f.branchId), eq(entities.id, id)))
  if (found === undefined) throw new Error(`no entity ${id}`)
  return found
}

// A user edit lands unanchored after the prose; a later turn's lands anchored past E. Either
// writes the whole state, as the World editor and a pass do.
async function editAs(
  who: 'user' | 'later-turn',
  patch: { description?: string; state?: Readonly<Record<string, unknown>> },
): Promise<void> {
  const current = await row()
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'updateEntity',
        source: who === 'user' ? 'user_edit' : 'per_turn_classifier',
        payload: {
          branchId: f.branchId,
          id: WREN,
          patch: {
            ...(patch.description === undefined ? {} : { description: patch.description }),
            ...(patch.state === undefined
              ? {}
              : {
                  state: {
                    ...(current.state as Record<string, unknown>),
                    ...patch.state,
                  } as EntityState,
                }),
          },
        },
      },
      actionId: who === 'user' ? 'act_user_edit' : 'act_close_turn_5',
      branchId: f.branchId,
      entryId: who === 'user' ? null : laterReplyId(),
    },
    f.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${who} edit refused: ${result.reason}`)
}

function writeContext(proseEntryId = endEntryId()): WriteContext {
  return {
    db: f.ctx.db,
    branchId: f.branchId,
    endEntryId: endEntryId(),
    task: 'identity',
    part: 1,
    ids: new CloseIds(),
    readFields: {},
    survivorOf: () => undefined,
    turns: [proseEntryId],
    proseEntryId,
    guard: (rows) =>
      readRowGuard({ branchId: f.branchId, endEntryId: endEntryId(), proseEntryId, rows }, f.ctx),
  }
}

const pick = (
  from: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(fields.filter((field) => field in from).map((field) => [field, from[field]]))

// The test tool's arguments by the delta path each lands at.
function wantedFields(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const paths: Record<string, string> = {
    description: 'description',
    voice: 'state.voice',
    traits: 'state.traits',
  }
  return Object.fromEntries(
    Object.entries(paths)
      .filter(([arg]) => args[arg] !== undefined)
      .map(([arg, path]) => [path, args[arg]]),
  )
}

// A character write as 5.5b's update_character plans it; `refuse` stands in for a soft cap the tool
// applies to free fields between fieldVerdicts and entityWriteAction.
async function planSetFields(args: Record<string, unknown>, ctx: WriteContext): Promise<WritePlan> {
  const id = args.id as string
  const wanted = wantedFields(args)
  const [current] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), eq(entities.id, id)))
  if (current === undefined)
    return {
      kind: 'refused',
      reason: CLOSE_REASON.rowGone,
      rows: [{ table: 'entities', id, name: ctx.ids.nameOfId(id) ?? '' }],
      values: wanted,
    }
  const guard = await ctx.guard([{ table: 'entities', id }])
  const refused = new Set((args.refuse as string[] | undefined) ?? [])
  const lost: LostField[] = []
  const free: Record<string, unknown> = {}
  const restated = restatedFields(current, wanted)
  const pending = Object.keys(wanted).filter((field) => !restated.includes(field))
  for (const verdict of fieldVerdicts(guard.row('entities', id), pending)) {
    if (!verdict.free)
      lost.push({ field: verdict.field, reason: verdict.reason, kind: 'protected' })
    else if (refused.has(verdict.field))
      lost.push({ field: verdict.field, reason: TEST_CAP, kind: 'refused' })
    else free[verdict.field] = wanted[verdict.field]
  }
  const planned = Object.keys(free).length > 0 ? entityWriteAction(current, free) : undefined
  const written = planned?.fields ?? []
  return {
    kind: 'write',
    actions: planned !== undefined && written.length > 0 ? [planned] : [],
    lost,
    rows: [{ table: 'entities', id, name: current.name }],
    values: pick(wanted, [...written, ...lost.map((loss) => loss.field)]),
  }
}

function asWrite(plan: WritePlan): Extract<WritePlan, { kind: 'write' }> {
  if (plan.kind !== 'write') throw new Error(`expected a write plan, refused: ${plan.reason}`)
  return plan
}

function applyGroup(plan: Extract<WritePlan, { kind: 'write' }>): Promise<GroupOutcome> {
  return applyDeltaActionGroupWithOutcomes(
    plan.actions.map(({ action }) => action),
    { actionId: GROUP_ACTION, branchId: f.branchId, entryId: endEntryId() },
    f.ctx,
  )
}

function groupDeltas() {
  return f.ctx.db.select().from(deltas).where(eq(deltas.actionId, GROUP_ACTION))
}

const input = (fields: Record<string, unknown>): Record<string, unknown> => ({
  id: WREN,
  turns: ['t7'],
  why: 'She says so at the toll house.',
  ...fields,
})

// Answers by `column|path`, as RowVerdicts is asked, and records each question to both halves.
function stubVerdicts(written: { user?: readonly string[]; later?: readonly string[] }): {
  row: RowVerdicts
  asked: string[]
  askedLater: string[]
} {
  const asked: string[] = []
  const askedLater: string[] = []
  const key = (column: string, path: readonly string[] = []): string => [column, ...path].join('|')
  const row: RowVerdicts = {
    userWrote: (column, path) => {
      asked.push(key(column, path))
      return (written.user ?? []).includes(key(column, path))
    },
    laterTurnWrote: (column, path) => {
      askedLater.push(key(column, path))
      return (written.later ?? []).includes(key(column, path))
    },
    userTouched: () => (written.user ?? []).length > 0,
    laterTurnTouched: () => (written.later ?? []).length > 0,
  }
  return { row, asked, askedLater }
}

describe('fieldVerdicts', () => {
  it('leaves a field free when neither the user nor a later turn wrote it', () => {
    const { row } = stubVerdicts({ user: ['state|traits'], later: ['name'] })

    expect(fieldVerdicts(row, ['description', 'state.voice'])).toEqual([
      { field: 'description', free: true },
      { field: 'state.voice', free: true },
    ])
  })

  it('protects a field the user wrote after the prose, and one a later turn wrote', () => {
    const { row } = stubVerdicts({ user: ['state|voice'], later: ['description'] })

    expect(fieldVerdicts(row, ['state.voice', 'description', 'state.traits'])).toEqual([
      { field: 'state.voice', free: false, reason: USER_EDITED_SINCE_PROSE },
      { field: 'description', free: false, reason: CLOSE_REASON.laterTurn },
      { field: 'state.traits', free: true },
    ])
  })

  it('protects only the state sub-field a later turn wrote, not its siblings', () => {
    const { row } = stubVerdicts({ later: ['state|voice'] })

    expect(fieldVerdicts(row, ['state.voice', 'state.traits'])).toEqual([
      { field: 'state.voice', free: false, reason: CLOSE_REASON.laterTurn },
      { field: 'state.traits', free: true },
    ])
  })

  it("reports the user's reason when a later turn wrote the field too", () => {
    const { row } = stubVerdicts({ user: ['description'], later: ['description'] })

    expect(fieldVerdicts(row, ['description'])).toEqual([
      { field: 'description', free: false, reason: USER_EDITED_SINCE_PROSE },
    ])
  })

  it('asks a top-level column with no path and a state sub-field by its path inside state', () => {
    const { row, asked, askedLater } = stubVerdicts({})

    fieldVerdicts(row, ['description', 'state.voice', 'state.visual.face'])

    const paths = ['description', 'state|voice', 'state|visual|face']
    expect(asked).toEqual(paths)
    expect(askedLater).toEqual(paths)
  })
})

describe('restatedFields', () => {
  it('lists the wanted paths the row already holds, columns and state sub-fields alike', () => {
    expect(
      restatedFields(CHARACTER, {
        description: 'A courier.',
        name: 'Wren, again',
        'state.voice': 'soft',
        'state.traits': ['patient', 'wary'],
        'state.visual.hair': 'black',
        'state.visual': { hair: 'black' },
      }),
    ).toEqual(['description', 'state.voice', 'state.visual.hair', 'state.visual'])
  })

  it("reads a row with no state as the kind's empty state", () => {
    expect(
      restatedFields({ ...CHARACTER, state: null }, { 'state.traits': [], 'state.voice': 'soft' }),
    ).toEqual(['state.traits'])
  })
})

describe('entityWriteAction', () => {
  it('merges state sub-fields over the current state, top-level columns in the same patch', () => {
    expect(
      entityWriteAction(CHARACTER, {
        description: 'A tired courier.',
        'state.voice': 'hoarse',
        'state.traits': ['patient', 'wary'],
      }),
    ).toEqual({
      action: {
        kind: 'updateEntity',
        source: 'chapter_close',
        payload: {
          branchId: 'br_close',
          id: WREN,
          patch: {
            description: 'A tired courier.',
            state: { ...WREN_STATE, voice: 'hoarse', traits: ['patient', 'wary'] },
          },
        },
      },
      fields: ['description', 'state.voice', 'state.traits'],
    })
  })

  it("starts from the kind's empty state when the row has none", () => {
    const planned = entityWriteAction({ ...CHARACTER, state: null }, { 'state.voice': 'hoarse' })

    expect(planned.action).toMatchObject({
      payload: { patch: { state: { ...emptyEntityState('character'), voice: 'hoarse' } } },
    })
    expect(planned.fields).toEqual(['state.voice'])
  })

  it('writes a nested sub-field and keeps its siblings', () => {
    const planned = entityWriteAction(CHARACTER, { 'state.visual.face': 'scarred' })

    expect(planned.action).toMatchObject({
      payload: { patch: { state: { visual: { hair: 'black', face: 'scarred' } } } },
    })
    expect(planned.fields).toEqual(['state.visual.face'])
  })

  it('leaves a value already stored out of the fields it tags', () => {
    expect(
      entityWriteAction(CHARACTER, { description: 'A courier.', 'state.voice': 'hoarse' }).fields,
    ).toEqual(['state.voice'])
    expect(
      entityWriteAction(CHARACTER, { description: 'A courier.', 'state.traits': ['patient'] })
        .fields,
    ).toEqual([])
  })

  it('compares a stored object by its keys and values, not by identity', () => {
    const stored = { ...WREN_STATE.visual }

    expect(entityWriteAction(CHARACTER, { 'state.visual': stored }).fields).toEqual([])
    expect(
      entityWriteAction(CHARACTER, { 'state.visual': { ...stored, face: 'scarred' } }).fields,
    ).toEqual(['state.visual'])
  })

  it("counts a value the kind's empty state already holds as stored when the row has no state", () => {
    expect(entityWriteAction({ ...CHARACTER, state: null }, { 'state.traits': [] }).fields).toEqual(
      [],
    )
  })

  it('never changes the row it reads', () => {
    const before = JSON.parse(JSON.stringify(CHARACTER)) as Entity

    entityWriteAction(CHARACTER, { 'state.voice': 'hoarse', 'state.visual.face': 'scarred' })

    expect(CHARACTER).toEqual(before)
  })

  it('refuses an empty write, which the handler would refuse for the whole group', () => {
    expect(() => entityWriteAction(CHARACTER, {})).toThrow(/nothing to write/)
  })
})

describe('the entity write path', () => {
  beforeEach(async () => {
    f = await openCloseFixture()
    await seedCharacter(WREN, 'Wren')
  })

  it('lands two state sub-fields as one updateEntity and one delta', async () => {
    const plan = asWrite(
      await planSetFields(input({ voice: 'low and dry', traits: ['wary'] }), writeContext()),
    )
    expect(plan.actions).toHaveLength(1)
    expect(plan.actions[0]!.fields).toEqual(['state.voice', 'state.traits'])

    const outcome = await applyGroup(plan)

    expect(outcome).toEqual({ status: 'ok', outcomes: [{ status: 'landed' }] })
    expect(await groupDeltas()).toHaveLength(1)
    expect((await row()).state).toMatchObject({ voice: 'low and dry', traits: ['wary'] })
    const verdict = verdictOf(plan, outcome, NO_SURVIVOR)
    expect(verdict.result).toBe('ok')
    expect([...verdict.landed].sort()).toEqual(['state.traits', 'state.voice'])
    expect(verdict.skippedFields).toEqual([])
  })

  it('lands the free sub-field beside a protected one, ok naming the skipped field', async () => {
    await editAs('user', { state: { voice: 'gravel' } })

    const plan = asWrite(
      await planSetFields(input({ voice: 'low', traits: ['wary'] }), writeContext()),
    )
    expect(plan.lost).toEqual([
      { field: 'state.voice', reason: USER_EDITED_SINCE_PROSE, kind: 'protected' },
    ])
    expect(plan.actions.map(({ fields }) => fields)).toEqual([['state.traits']])

    const outcome = await applyGroup(plan)

    expect((await row()).state).toMatchObject({ voice: 'gravel', traits: ['wary'] })
    const verdict = verdictOf(plan, outcome, NO_SURVIVOR)
    expect(verdict.result).toBe('ok')
    expect(verdict.landed).toEqual(['state.traits'])
    expect(verdict.skippedFields).toEqual([
      { field: 'state.voice', reason: USER_EDITED_SINCE_PROSE },
    ])
  })

  it('lands a description alone beside an all-protected state, ok naming the sub-fields', async () => {
    await editAs('user', { state: { voice: 'gravel', traits: ['stubborn'] } })

    const plan = asWrite(
      await planSetFields(
        input({ description: 'A courier, soaked.', voice: 'low', traits: ['wary'] }),
        writeContext(),
      ),
    )
    expect(plan.actions).toEqual([
      {
        action: {
          kind: 'updateEntity',
          source: 'chapter_close',
          payload: { branchId: f.branchId, id: WREN, patch: { description: 'A courier, soaked.' } },
        },
        fields: ['description'],
      },
    ])

    const outcome = await applyGroup(plan)

    expect(await groupDeltas()).toHaveLength(1)
    const stored = await row()
    expect(stored.description).toBe('A courier, soaked.')
    expect(stored.state).toMatchObject({ voice: 'gravel', traits: ['stubborn'] })
    const verdict = verdictOf(plan, outcome, NO_SURVIVOR)
    expect(verdict.result).toBe('ok')
    expect(verdict.landed).toEqual(['description'])
    expect(verdict.skippedFields).toHaveLength(2)
    expect(verdict.skippedFields).toEqual(
      expect.arrayContaining([
        { field: 'state.voice', reason: USER_EDITED_SINCE_PROSE },
        { field: 'state.traits', reason: USER_EDITED_SINCE_PROSE },
      ]),
    )
  })

  it('keeps a free field the tool refuses out of the action', async () => {
    const plan = asWrite(
      await planSetFields(
        input({ voice: 'low', traits: ['wary'], refuse: ['state.traits'] }),
        writeContext(),
      ),
    )
    const [planned] = plan.actions
    expect(planned!.fields).toEqual(['state.voice'])
    expect(planned!.action).toMatchObject({
      payload: { patch: { state: { voice: 'low', traits: ['patient'] } } },
    })

    const outcome = await applyGroup(plan)

    expect((await row()).state).toMatchObject({ voice: 'low', traits: ['patient'] })
    const verdict = verdictOf(plan, outcome, NO_SURVIVOR)
    expect(verdict.result).toBe('ok')
    expect(verdict.skippedFields).toEqual([{ field: 'state.traits', reason: TEST_CAP }])
  })

  it('reads a protected field the tool only restates as ok, nothing written', async () => {
    await editAs('user', { state: { voice: 'gravel' } })

    const plan = asWrite(await planSetFields(input({ voice: 'gravel' }), writeContext()))

    expect(plan.lost).toEqual([])
    expect(plan.actions).toEqual([])
    expect(verdictOf(plan, null, NO_SURVIVOR)).toEqual({
      result: 'ok',
      landed: [],
      skippedFields: [],
    })
  })

  it('skips a field a later turn wrote, as later-turn, beside one that lands', async () => {
    await editAs('later-turn', { description: 'Wren, at the toll house.' })

    const plan = asWrite(
      await planSetFields(input({ description: 'A courier.', voice: 'low' }), writeContext()),
    )
    const outcome = await applyGroup(plan)

    const stored = await row()
    expect(stored.description).toBe('Wren, at the toll house.')
    expect(stored.state).toMatchObject({ voice: 'low' })
    const verdict = verdictOf(plan, outcome, NO_SURVIVOR)
    expect(verdict.result).toBe('ok')
    expect(verdict.skippedFields).toEqual([
      { field: 'description', reason: CLOSE_REASON.laterTurn },
    ])
  })
})

const BRAM = 'char_00000000-0000-4000-8000-000000000002'
// Shown to the model but never written: the row a merge absorbed.
const GONE = 'char_00000000-0000-4000-8000-000000000003'
const KIND = 'close-dispatch-test'
// Any full id the model must never read.
const FULL_ID = /(?:char|loc|item|fact|lore|thr|hap|chap|haw)_[0-9a-f]{8}-|entry_close_/

const chapterEntryIds = (): string[] => f.entries.slice(0, 7).map((entry) => entry.id)

type ScriptedCall = { toolName: string; input: Record<string, unknown> }

let script: ScriptedCall[] = []
let seeds: GuardRow[] = []
let setup: ((ids: CloseIds, ledger: CloseLedgerWriter) => void) | undefined
let answers: ToolAnswer[] = []
let seenProse: string[] = []
let ledger: CloseLedger | undefined
let shown: CloseIds | undefined

const setFieldsTool: WriteTool = {
  kind: 'write',
  name: 'set_fields',
  description: "Set a character's description, voice or traits.",
  schema: writeToolSchema({
    id: z.string(),
    description: z.string().optional(),
    voice: z.string().optional(),
    traits: z.array(z.string()).optional(),
    refuse: z.array(z.string()).optional(),
  }),
  ids: { id: { shape: 'single', prefixes: ['char'] } },
  plan: (args, ctx) => {
    seenProse.push(ctx.proseEntryId)
    return planSetFields(args, ctx)
  },
}

// Writes the description without comparing it first, so a restated value reaches the handler.
const blindSetTool: WriteTool = {
  kind: 'write',
  name: 'blind_set',
  description: "Set a character's description.",
  schema: writeToolSchema({ id: z.string(), description: z.string() }),
  ids: { id: { shape: 'single', prefixes: ['char'] } },
  plan: async (args, ctx) => {
    const id = args.id as string
    const description = args.description as string
    return {
      kind: 'write',
      actions: [
        {
          action: {
            kind: 'updateEntity',
            source: 'chapter_close',
            payload: { branchId: ctx.branchId, id, patch: { description } },
          },
          fields: ['description'],
        },
      ],
      lost: [],
      rows: [{ table: 'entities', id, name: ctx.ids.nameOfId(id) ?? '' }],
      values: { description },
    }
  },
}

const createNoteTool: WriteTool = {
  kind: 'write',
  name: 'create_note',
  description: 'Create a lore note.',
  schema: writeToolSchema({ title: z.string(), body: z.string() }),
  ids: {},
  plan: async (args, ctx) => {
    const id = generateId('lore')
    const title = args.title as string
    const body = args.body as string
    return {
      kind: 'write',
      actions: [
        {
          action: {
            kind: 'createLore',
            source: 'chapter_close',
            payload: {
              entry: {
                id,
                branchId: ctx.branchId,
                title,
                body,
                injectionMode: 'auto',
                createdAt: 1,
                updatedAt: 1,
              },
            },
          },
          fields: ['title', 'body'],
        },
      ],
      lost: [],
      rows: [{ table: 'lore', id, name: title }],
      values: { title, body },
      createdId: id,
    }
  },
}

// Refuses with a reason naming the row it was given by its full id, as a handler's reason can.
const refuseNoteTool: WriteTool = {
  kind: 'write',
  name: 'refuse_note',
  description: 'Create a lore note unless it clashes with a row.',
  schema: writeToolSchema({ title: z.string(), body: z.string(), other: z.string() }),
  ids: { other: { shape: 'single', prefixes: ['char'] } },
  plan: async (args) => ({
    kind: 'refused',
    reason: `the note clashes with ${args.other as string}`,
    rows: [],
    values: { title: args.title, body: args.body },
  }),
}

const peekRowTool: ReadTool = {
  kind: 'read',
  name: 'peek_row',
  description: 'Read one character.',
  schema: readToolSchema({ id: z.string() }),
  ids: { id: { shape: 'single', prefixes: ['char'] } },
  read: async (args, ctx) => {
    const id = args.id as string
    return {
      output: { id: ctx.ids.handleOf(id) },
      rows: [{ table: 'entities', id, name: ctx.ids.nameOfId(id) ?? '' }],
      read: [{ table: 'entities', id }],
    }
  },
}

// Answers with the row's full id, which dispatch must swap for its handle.
const peekRawTool: ReadTool = {
  kind: 'read',
  name: 'peek_raw',
  description: 'Read one character, raw.',
  schema: readToolSchema({ id: z.string() }),
  ids: { id: { shape: 'single', prefixes: ['char'] } },
  read: async (args) => ({ output: { row: args.id }, rows: [], read: [] }),
}

// A merge's shape: `other` folds into `id`, which keeps the description given, written blind.
const keepRowTool: WriteTool = {
  kind: 'write',
  name: 'keep_row',
  description: 'Fold one character into another.',
  schema: writeToolSchema({ id: z.string(), other: z.string(), description: z.string() }),
  ids: {
    id: { shape: 'single', prefixes: ['char'] },
    other: { shape: 'single', prefixes: ['char'] },
  },
  plan: async (args, ctx) => {
    const id = args.id as string
    const other = args.other as string
    const description = args.description as string
    return {
      kind: 'write',
      actions: [
        {
          action: {
            kind: 'updateEntity',
            source: 'chapter_close',
            payload: { branchId: ctx.branchId, id, patch: { description } },
          },
          fields: ['description'],
        },
      ],
      lost: [],
      rows: [
        { table: 'entities', id, name: ctx.ids.nameOfId(id) ?? '' },
        { table: 'entities', id: other, name: ctx.ids.nameOfId(other) ?? '' },
      ],
      values: { description },
      survivor: { table: 'entities', id },
    }
  },
}

const TOOLS: Readonly<Record<string, CloseTool>> = {
  set_fields: setFieldsTool,
  blind_set: blindSetTool,
  keep_row: keepRowTool,
  create_note: createNoteTool,
  refuse_note: refuseNoteTool,
  peek_row: peekRowTool,
  peek_raw: peekRawTool,
}

// Stands where the agent phase will: the run's ids and ledger, a fresh read set, the script's calls.
async function* dispatchPhase(
  phase: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const ids = closeIdsOf(phase.intermediates)
  ids.showTurns(chapterEntryIds())
  ids.show(WREN, 'Wren')
  ids.show(BRAM, 'Bram')
  ids.show(GONE, 'Old Wren')
  ledger = seedCloseLedger(phase.intermediates)
  const writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id))
  setup?.(ids, writer)
  shown = ids
  const readSet = createReadSet()
  readSet.add(seeds)
  const ctx: DispatchContext = {
    db: phase.db,
    branchId: phase.branchId,
    endEntryId: endEntryId(),
    task: 'identity',
    part: 1,
    ids,
    readFields: {},
    survivorOf: (table, id) => writer.survivorOf(table, id),
    phase,
    chapterEntryIds: chapterEntryIds(),
    readSet,
    ledger: writer,
  }
  for (const [index, { toolName, input }] of script.entries()) {
    const tool = TOOLS[toolName]
    if (tool === undefined) throw new Error(`no test tool ${toolName}`)
    answers.push(
      yield* dispatchToolCall({ toolCallId: `call_${index + 1}`, toolName, input }, tool, ctx),
    )
  }
  return { status: 'completed' }
}

async function runDispatch(
  calls: ScriptedCall[],
): Promise<{ result: TxResult; events: PipelineEvent[] }> {
  script = calls
  const events: PipelineEvent[] = []
  pipelineEventBus.subscribeAll((event) => {
    events.push(event)
  })
  const result = expectRan(
    await runPipeline(KIND, {
      storyId: f.storyId,
      branchId: f.branchId,
      db: f.ctx.db,
      runInTransaction: f.ctx.runInTransaction,
    }),
  )
  expect(result.outcome).toBe('completed')
  return { result, events }
}

const groupEvents = (events: readonly PipelineEvent[]): PipelineEvent[] =>
  events.filter((event) => event.type === 'delta_group_emitted')

function recorded(): CloseLedger['calls'] {
  if (ledger === undefined) throw new Error('the phase never ran')
  return ledger.calls
}

function runDeltas(actionId: string) {
  return f.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(asc(deltas.logPosition))
}

const cite = (turns: string[], why = 'She says so at the toll house.') => ({ turns, why })

describe('dispatchToolCall in a close phase', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(async () => {
    __resetRegistry()
    __resetBus()
    f = await openCloseFixture()
    await seedCharacter(WREN, 'Wren')
    await seedCharacter(BRAM, 'Bram')
    script = []
    seeds = [{ table: 'entities', id: WREN }]
    setup = undefined
    answers = []
    seenProse = []
    ledger = undefined
    shown = undefined
    definePipeline({
      kind: KIND,
      phases: [{ name: 'agent', run: dispatchPhase }],
      affordance: 'invisible',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    })
  })

  it('refuses a write citing nothing, a turn outside the chapter or an unread row, emitting no group', async () => {
    // t8: an entry past E, shown as 5.9's read_turns will show one.
    setup = (ids) => {
      ids.showTurn(f.entries[9]!.id)
    }

    const { result, events } = await runDispatch([
      { toolName: 'set_fields', input: { id: 'c1', description: 'Soaked.', ...cite([]) } },
      { toolName: 'set_fields', input: { id: 'c1', description: 'Soaked.', ...cite(['t8']) } },
      {
        toolName: 'set_fields',
        input: { id: 'c2', description: 'Soaked.', ...cite(['t7'], 'He waits.') },
      },
    ])

    expect(recorded().map((call) => call.result)).toEqual(['rejected', 'rejected', 'rejected'])
    expect(recorded()[2]).toMatchObject({
      tool: 'set_fields',
      rows: [{ table: 'entities', id: BRAM, name: 'Bram' }],
      why: 'He waits.',
      turns: [endEntryId()],
      result: 'rejected',
    })
    expect(seenProse).toEqual([])
    expect(groupEvents(events)).toEqual([])
    expect(await runDeltas(result.actionId)).toEqual([])
    expect((await row(WREN)).description).toBe('A courier.')
  })

  it('refuses a handle it never showed, naming it', async () => {
    await runDispatch([
      { toolName: 'set_fields', input: { id: 'c9', description: 'Soaked.', ...cite(['t7']) } },
    ])

    expect(recorded()).toEqual([
      expect.objectContaining({
        result: 'rejected',
        rows: [],
        reason: expect.stringContaining('c9'),
      }),
    ])
  })

  it("counts a seeded start row as read, and lands with chapter_close, the run's action and E", async () => {
    const { result, events } = await runDispatch([
      {
        toolName: 'set_fields',
        input: {
          id: 'c1',
          description: 'Soaked through.',
          voice: 'hoarse',
          ...cite(['t5'], 'The rain.'),
        },
      },
    ])

    expect(recorded()).toEqual([
      {
        task: 'identity',
        part: 1,
        tool: 'set_fields',
        rows: [{ table: 'entities', id: WREN, name: 'Wren' }],
        why: 'The rain.',
        turns: [f.entries[4]!.id],
        result: 'ok',
        values: { description: 'Soaked through.', 'state.voice': 'hoarse' },
      },
    ])
    expect(groupEvents(events)).toHaveLength(1)
    const written = await runDeltas(result.actionId)
    expect(written).toHaveLength(1)
    for (const delta of written)
      expect(delta).toMatchObject({
        source: 'chapter_close',
        actionId: result.actionId,
        entryId: endEntryId(),
      })
  })

  it('refuses a row the start only showed until read_row reads it', async () => {
    const write: ScriptedCall = {
      toolName: 'set_fields',
      input: { id: 'c2', description: 'Bram, at the toll.', ...cite(['t7'], 'He waits.') },
    }

    await runDispatch([write, { toolName: 'peek_row', input: { id: 'c2' } }, write])

    expect(recorded().map((call) => [call.tool, call.result])).toEqual([
      ['set_fields', 'rejected'],
      ['peek_row', 'ok'],
      ['set_fields', 'ok'],
    ])
    expect(recorded()[1]).toEqual({
      task: 'identity',
      part: 1,
      tool: 'peek_row',
      rows: [{ table: 'entities', id: BRAM, name: 'Bram' }],
      why: '',
      turns: [],
      result: 'ok',
    })
    expect(answers[1]!.output).toEqual({ id: 'c2' })
    expect((await row(BRAM)).description).toBe('Bram, at the toll.')
  })

  it('hands the plan the latest cited turn by position, not by citation order', async () => {
    await runDispatch([
      {
        toolName: 'set_fields',
        input: { id: 'c1', description: 'Soaked.', ...cite(['t5', 't3']) },
      },
    ])

    expect(seenProse).toEqual([f.entries[4]!.id])
    const turns = recorded()[0]!.turns
    expect(turns).toHaveLength(2)
    expect(turns).toEqual(expect.arrayContaining([f.entries[4]!.id, f.entries[2]!.id]))
  })

  it('emits no group when nothing is left to land: skipped if protected, rejected if refused', async () => {
    await editAs('user', { state: { voice: 'gravel' } })
    await editAs('later-turn', { description: 'Wren, at the toll house.' })

    const { result, events } = await runDispatch([
      { toolName: 'set_fields', input: { id: 'c1', voice: 'low', ...cite(['t7']) } },
      { toolName: 'set_fields', input: { id: 'c1', description: 'Soaked.', ...cite(['t7']) } },
      {
        toolName: 'set_fields',
        input: { id: 'c1', traits: ['wary'], refuse: ['state.traits'], ...cite(['t7']) },
      },
    ])

    expect(
      recorded().map((call) => ({ result: call.result, reason: call.reason, values: call.values })),
    ).toEqual([
      { result: 'skipped', reason: USER_EDITED_SINCE_PROSE, values: { 'state.voice': 'low' } },
      { result: 'skipped', reason: CLOSE_REASON.laterTurn, values: { description: 'Soaked.' } },
      { result: 'rejected', reason: TEST_CAP, values: { 'state.traits': 'wary' } },
    ])
    expect(groupEvents(events)).toEqual([])
    expect(await runDeltas(result.actionId)).toEqual([])
  })

  it("keeps a refused plan's proposed values, and names a gone row's survivor to the model only", async () => {
    seeds = [
      { table: 'entities', id: WREN },
      { table: 'entities', id: GONE },
    ]
    setup = (_ids, writer) => {
      writer.record({
        task: 'happenings',
        part: 0,
        tool: 'merge_characters',
        rows: [
          { table: 'entities', id: WREN, name: 'Wren' },
          { table: 'entities', id: GONE, name: 'Old Wren' },
        ],
        why: 'One courier.',
        turns: [],
        result: 'ok',
        values: { name: 'Wren' },
        survivor: { table: 'entities', id: WREN },
      })
    }

    await runDispatch([
      {
        toolName: 'set_fields',
        input: { id: 'c3', description: 'Older.', ...cite(['t7'], 'She was older.') },
      },
    ])

    expect(recorded()[1]).toEqual({
      task: 'identity',
      part: 1,
      tool: 'set_fields',
      rows: [{ table: 'entities', id: GONE, name: 'Old Wren' }],
      why: 'She was older.',
      turns: [endEntryId()],
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      values: { description: 'Older.' },
    })
    const told = JSON.stringify(answers[0]!.output)
    expect(told).toContain('c1')
    expect(told).not.toMatch(FULL_ID)
  })

  it('names the survivor of a row the handler finds gone to the model, not the ledger', async () => {
    seeds = [
      { table: 'entities', id: WREN },
      { table: 'entities', id: GONE },
    ]
    setup = (_ids, writer) => {
      writer.record({
        task: 'happenings',
        part: 0,
        tool: 'merge_characters',
        rows: [
          { table: 'entities', id: WREN, name: 'Wren' },
          { table: 'entities', id: GONE, name: 'Old Wren' },
        ],
        why: 'One courier.',
        turns: [],
        result: 'ok',
        survivor: { table: 'entities', id: WREN },
      })
    }

    await runDispatch([
      { toolName: 'blind_set', input: { id: 'c3', description: 'Older.', ...cite(['t7']) } },
    ])

    expect(recorded()[1]).toMatchObject({ result: 'rejected', reason: CLOSE_REASON.rowGone })
    expect(recorded()[1]).not.toHaveProperty('survivor')
    expect(answers[0]!.output).toMatchObject({ result: 'rejected', survivor: 'c1' })
  })

  it("keeps a restated field out of the ledger's values, from the plan or the handler", async () => {
    const { result } = await runDispatch([
      {
        toolName: 'set_fields',
        input: { id: 'c1', description: 'Soaked.', voice: 'soft', ...cite(['t7']) },
      },
      { toolName: 'blind_set', input: { id: 'c1', description: 'Soaked.', ...cite(['t7']) } },
    ])

    expect(recorded()[0]).toMatchObject({ result: 'ok' })
    expect(recorded()[0]!.values).toEqual({ description: 'Soaked.' })
    expect(recorded()[1]).toMatchObject({ result: 'ok' })
    expect(recorded()[1]).not.toHaveProperty('values')
    expect(await runDeltas(result.actionId)).toHaveLength(1)
  })

  it("shows a landed create's handle, so a later text naming it is stored with its name", async () => {
    await runDispatch([
      {
        toolName: 'create_note',
        input: { title: 'The Toll', body: 'Paid at the river.', ...cite(['t7']) },
      },
      {
        toolName: 'set_fields',
        input: {
          id: 'c1',
          description: 'Owes the toll (lo1).',
          ...cite(['t7'], 'Learned at lo1.'),
        },
      },
    ])

    const created = recorded()[0]!.rows[0]!.id
    expect(shown!.handleOf(created)).toBe('lo1')
    expect(recorded()[1]!.why).toBe('Learned at The Toll.')
    expect((await row(WREN)).description).toBe('Owes the toll (The Toll).')
    const [note] = await f.ctx.db.select().from(lore).where(eq(lore.id, created))
    expect(note).toMatchObject({ title: 'The Toll', body: 'Paid at the river.' })
  })

  it('never lets a full id reach the model; the ledger keeps the original reason', async () => {
    await runDispatch([
      {
        toolName: 'refuse_note',
        input: { title: 'The Toll', body: 'Paid.', other: 'c1', ...cite(['t7']) },
      },
      { toolName: 'peek_raw', input: { id: 'c1' } },
    ])

    expect(recorded()[0]).toMatchObject({
      result: 'rejected',
      reason: `the note clashes with ${WREN}`,
      values: { title: 'The Toll', body: 'Paid.' },
    })
    const told = JSON.stringify(answers[0]!.output)
    expect(told).toContain('clashes with c1')
    expect(told).not.toMatch(FULL_ID)
    expect(answers[1]!.output).toEqual({ row: 'c1' })
  })

  it("records a merge's kept row only when something landed", async () => {
    seeds = [
      { table: 'entities', id: WREN },
      { table: 'entities', id: BRAM },
    ]

    await runDispatch([
      {
        toolName: 'keep_row',
        input: { id: 'c1', other: 'c2', description: 'A courier.', ...cite(['t7']) },
      },
      {
        toolName: 'keep_row',
        input: { id: 'c1', other: 'c2', description: 'Two couriers.', ...cite(['t7']) },
      },
    ])

    expect(recorded()[0]).toMatchObject({ result: 'ok' })
    expect(recorded()[0]).not.toHaveProperty('survivor')
    expect(recorded()[0]).not.toHaveProperty('values')
    expect(recorded()[1]).toMatchObject({
      result: 'ok',
      values: { description: 'Two couriers.' },
      survivor: { table: 'entities', id: WREN },
    })
  })

  it("logs a group's whole refusal and each noop at debug", async () => {
    seeds = [
      { table: 'entities', id: WREN },
      { table: 'entities', id: GONE },
    ]
    const debug = vi.spyOn(logger, 'debug')

    const { result } = await runDispatch([
      { toolName: 'blind_set', input: { id: 'c1', description: 'A courier.', ...cite(['t7']) } },
      { toolName: 'blind_set', input: { id: 'c3', description: 'Older.', ...cite(['t7']) } },
    ])

    expect(debug).toHaveBeenCalledWith(
      'memory.close_tool_action_noop',
      expect.objectContaining({ tool: 'blind_set', kind: 'updateEntity', mark: 'restated' }),
      { actionId: result.actionId },
    )
    expect(debug).toHaveBeenCalledWith(
      'memory.close_tool_group_rejected',
      expect.objectContaining({ tool: 'blind_set', kinds: ['updateEntity'], code: 'not-found' }),
      { actionId: result.actionId },
    )
    expect(recorded().map((call) => [call.result, call.reason])).toEqual([
      ['ok', undefined],
      ['rejected', CLOSE_REASON.rowGone],
    ])
  })
})
