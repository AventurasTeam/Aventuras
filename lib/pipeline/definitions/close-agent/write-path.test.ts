import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import { readRowGuard } from '@/lib/actions/delta/row-guard'
import { USER_EDITED_SINCE_PROSE, type GroupOutcome, type RowVerdicts } from '@/lib/actions/types'
import { deltas, emptyEntityState, entities, type Entity, type EntityState } from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { entityWriteAction, fieldVerdicts } from './entity-write'
import { CloseIds } from './ids'
import type { LostField, WriteContext, WritePlan } from './tool'
import { CLOSE_REASON, verdictOf } from './verdict'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'

// Substitutable ids must be real uuids: CloseIds.show allocates only those (lib/ids/prefixes.ts).
const WREN = 'char_00000000-0000-4000-8000-000000000001'
const GROUP_ACTION = 'act_close_group'
const TEST_CAP = 'over-test-cap'
const NO_SURVIVOR = { survivorOf: () => undefined }

const WREN_STATE: EntityState = {
  visual: { hair: 'black' },
  traits: ['patient'],
  drives: ['deliver the letter'],
  voice: 'soft',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

const CHARACTER: Entity = {
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
}

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
  for (const verdict of fieldVerdicts(guard.row('entities', id), Object.keys(wanted))) {
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

// Answers by `column|path`, as RowVerdicts is asked, and records each question to the user half.
function stubVerdicts(written: { user?: readonly string[]; later?: readonly string[] }): {
  row: RowVerdicts
  asked: string[]
} {
  const asked: string[] = []
  const key = (column: string, path: readonly string[] = []): string => [column, ...path].join('|')
  const row: RowVerdicts = {
    userWrote: (column, path) => {
      asked.push(key(column, path))
      return (written.user ?? []).includes(key(column, path))
    },
    laterTurnWrote: (column, path) => (written.later ?? []).includes(key(column, path)),
    userTouched: () => (written.user ?? []).length > 0,
    laterTurnTouched: () => (written.later ?? []).length > 0,
  }
  return { row, asked }
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

  it("reports the user's reason when a later turn wrote the field too", () => {
    const { row } = stubVerdicts({ user: ['description'], later: ['description'] })

    expect(fieldVerdicts(row, ['description'])).toEqual([
      { field: 'description', free: false, reason: USER_EDITED_SINCE_PROSE },
    ])
  })

  it('asks a top-level column with no path and a state sub-field by its path inside state', () => {
    const { row, asked } = stubVerdicts({})

    fieldVerdicts(row, ['description', 'state.voice', 'state.visual.face'])

    expect(asked).toEqual(['description', 'state|voice', 'state|visual|face'])
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

  it('never changes the row it reads', () => {
    const before = JSON.parse(JSON.stringify(CHARACTER)) as Entity

    // Values no other case writes: a mutated CHARACTER from an earlier case would otherwise hide a leak here.
    entityWriteAction(CHARACTER, { 'state.voice': 'unheard', 'state.visual.face': 'unseen' })

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
