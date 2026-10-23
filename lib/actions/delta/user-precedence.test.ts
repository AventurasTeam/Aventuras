import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  entities,
  stories,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { characterRelationshipsStore, entitiesStore, entriesStore } from '@/lib/stores'

import { registerEntities } from '../entities/register'
import { registerCharacterRelationships } from '../relationships/register'
import { updateStoryEntryContent } from '../story-entries/operational'
import { registerStoryEntries } from '../story-entries/register'
import type { DeltaSource, PipelineAction } from '../types'
import { applyDeltaAction } from './apply-delta-action'
import { __resetRegistry } from './registry'
import {
  proseLogPosition,
  userDeletedPairSince,
  userEditsSince,
  wroteColumn,
  wroteField,
  wrotePlacement,
} from './user-precedence'

async function setup() {
  __resetRegistry()
  registerStoryEntries()
  registerEntities()
  registerCharacterRelationships()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  entriesStore.__reset()
  entitiesStore.__reset()
  characterRelationshipsStore.__reset()
  entriesStore.hydrate('br_1', [])
  entitiesStore.hydrate('br_1', [])
  characterRelationshipsStore.hydrate('br_1', [])
  return { ctx: { db, runInTransaction } }
}

type Ctx = Awaited<ReturnType<typeof setup>>['ctx']

async function apply(ctx: Ctx, action: PipelineAction, actionId: string): Promise<number> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'br_1' }, ctx)
  if (result.status !== 'ok' || result.logPosition == null)
    throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
  return result.logPosition
}

const createEntry = (id: string, position: number): PipelineAction => ({
  kind: 'createStoryEntry',
  source: 'ai_classifier',
  payload: {
    entry: { id, branchId: 'br_1', position, kind: 'ai_reply', content: 'prose', createdAt: 1 },
  },
})

const CHAR: NewEntity = {
  id: 'char_1',
  branchId: 'br_1',
  kind: 'character',
  name: 'Kael',
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
}

const updateEntity = (
  source: DeltaSource,
  id: string,
  patch: Record<string, unknown>,
): PipelineAction => ({ kind: 'updateEntity', source, payload: { branchId: 'br_1', id, patch } })

async function pairRowId(ctx: Ctx, aId: string, bId: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: characterRelationships.id })
    .from(characterRelationships)
    .where(and(eq(characterRelationships.aId, aId), eq(characterRelationships.bId, bId)))
  if (row == null) throw new Error(`fixture: ${aId}/${bId} row missing`)
  return row.id
}

const deletePair = (id: string): PipelineAction => ({
  kind: 'deleteCharacterRelationship',
  source: 'user_edit',
  payload: { branchId: 'br_1', id },
})

async function seedChars(ctx: Ctx, ...ids: string[]): Promise<void> {
  await ctx.db.insert(entities).values(ids.map((id) => ({ ...CHAR, id })))
}

const relate = (subjectId: string, objectId: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'user_edit',
  payload: { branchId: 'br_1', subjectId, objectId, kind: 'ally', inverseKind: 'ally' },
})

describe('proseLogPosition', () => {
  it('is 0 for an entry the log has no create or content edit for', async () => {
    const { ctx } = await setup()
    expect(await proseLogPosition(ctx, 'br_1', 'e_1')).toBe(0)
  })

  it('reads the create, ignores a metadata update, and moves to a later content edit', async () => {
    const { ctx } = await setup()
    const created = await apply(ctx, createEntry('e_1', 1), 'act_e')
    await apply(ctx, createEntry('e_2', 2), 'act_e2')
    expect(await proseLogPosition(ctx, 'br_1', 'e_1')).toBe(created)

    await apply(
      ctx,
      {
        kind: 'updateStoryEntryMetadata',
        source: 'ai_classifier',
        payload: { branchId: 'br_1', id: 'e_1', metadata: { summary: 'a ride north' } },
      },
      'act_m',
    )
    expect(await proseLogPosition(ctx, 'br_1', 'e_1')).toBe(created)

    expect(await updateStoryEntryContent('br_1', 'e_1', 'rewritten prose', ctx)).toEqual({
      status: 'ok',
    })
    expect(await proseLogPosition(ctx, 'br_1', 'e_1')).toBeGreaterThan(created)
    expect(await proseLogPosition(ctx, 'br_1', 'e_2')).toBe(created + 1)
  })
})

describe('userEditsSince', () => {
  it("returns only the row's user_edit deltas logged after the given position, oldest first", async () => {
    const { ctx } = await setup()
    await apply(ctx, { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } }, 'a0')
    await apply(
      ctx,
      { kind: 'createEntity', source: 'user_edit', payload: { entry: { ...CHAR, id: 'char_2' } } },
      'a1',
    )
    const since = await apply(ctx, updateEntity('user_edit', 'char_1', { name: 'Kael I' }), 'a2')
    await apply(ctx, updateEntity('periodic_classifier', 'char_1', { name: 'Kael II' }), 'a3')
    const first = await apply(ctx, updateEntity('user_edit', 'char_1', { status: 'retired' }), 'a4')
    await apply(ctx, updateEntity('user_edit', 'char_2', { name: 'Mira' }), 'a5')
    const second = await apply(ctx, updateEntity('user_edit', 'char_1', { name: 'Kael' }), 'a6')

    const edits = await userEditsSince(ctx, 'br_1', 'entities', 'char_1', since)
    expect(edits.map((d) => d.logPosition)).toEqual([first, second])
    expect(edits.map((d) => d.undoPayload)).toEqual([{ status: 'active' }, { name: 'Kael II' }])
  })
})

describe('wroteColumn', () => {
  it('counts a create or an update carrying the column, not an update of another column', async () => {
    const { ctx } = await setup()
    await apply(ctx, { kind: 'createEntity', source: 'user_edit', payload: { entry: CHAR } }, 'a0')
    await apply(ctx, updateEntity('user_edit', 'char_1', { description: 'a knight' }), 'a1')
    const [create, update] = await userEditsSince(ctx, 'br_1', 'entities', 'char_1', 0)
    expect(wroteColumn([create], 'status')).toBe(true)
    expect(wroteColumn([update], 'status')).toBe(false)
    expect(wroteColumn([update], 'description')).toBe(true)
  })
})

// data-model.md → LocationState shape: the flag sits only beside a null parent.
describe('wrotePlacement', () => {
  it('counts a create, or an update carrying the parent or the flag, not another state key', async () => {
    const { ctx } = await setup()
    const VARN: NewEntity = {
      ...CHAR,
      id: 'loc_varn',
      kind: 'location',
      name: 'Varn',
      state: { parent_location_id: null, unplaced: true },
    }
    await ctx.db.insert(entities).values({ ...VARN, id: 'loc_reach', name: 'Reach', state: null })
    await apply(ctx, { kind: 'createEntity', source: 'user_edit', payload: { entry: VARN } }, 'a0')
    const state = (s: object) => updateEntity('user_edit', 'loc_varn', { state: s })
    await apply(ctx, state({ parent_location_id: null }), 'a1')
    await apply(ctx, state({ parent_location_id: null, condition: 'flooded' }), 'a2')
    await apply(ctx, state({ parent_location_id: 'loc_reach', condition: 'flooded' }), 'a3')
    const [create, flag, condition, parent] = await userEditsSince(
      ctx,
      'br_1',
      'entities',
      'loc_varn',
      0,
    )
    expect(flag.undoPayload).toEqual({ state: { unplaced: true } })
    expect(parent.undoPayload).toEqual({ state: { parent_location_id: null } })
    expect(wrotePlacement([create])).toBe(true)
    expect(wrotePlacement([flag])).toBe(true)
    expect(wrotePlacement([condition])).toBe(false)
    expect(wrotePlacement([parent])).toBe(true)
    expect(wrotePlacement([condition, parent])).toBe(true)
    expect(wrotePlacement([])).toBe(false)
  })
})

// cadence.md → User edits and classifier writes: parent and unplaced mark are one field.
describe('wroteField', () => {
  const update = (undoPayload: Record<string, unknown>) => ({ op: 'update', undoPayload }) as Delta
  const markedTop = [update({ state: { unplaced: true } })]
  const moved = [update({ state: { parent_location_id: 'loc_old' } })]

  it.each([['parent_location_id'], ['unplaced']])(
    "reads a user write to either half of a place's placement as a write to %s",
    (key) => {
      expect(wroteField(markedTop, 'entities', 'state', [key])).toBe(true)
      expect(wroteField(moved, 'entities', 'state', [key])).toBe(true)
    },
  )

  it('judges every other path as wrotePath does', () => {
    const conditioned = [update({ state: { condition: 'dry' } })]
    expect(wroteField(conditioned, 'entities', 'state', ['parent_location_id'])).toBe(false)
    expect(wroteField(conditioned, 'entities', 'state', ['condition'])).toBe(true)
    expect(wroteField(moved, 'entities', 'state', ['faction_id'])).toBe(false)
    expect(wroteField(markedTop, 'other_table', 'state', ['parent_location_id'])).toBe(false)
    expect(wroteField(moved, 'entities', 'description', ['parent_location_id'])).toBe(false)
  })

  // data-model.md → Authorship contract: flag, partner and reason hold together (the table's CHECK).
  it.each([['nameCollisionFlag'], ['nameCollisionPartnerId'], ['nameCollisionReason']])(
    "reads a user write to any of a row's collision-flag columns as a write to %s",
    (column) => {
      const repointed = [update({ nameCollisionPartnerId: 'char_old' })]
      const cleared = [update({ nameCollisionFlag: 1 })]
      expect(wroteField(repointed, 'entities', column, [])).toBe(true)
      expect(wroteField(cleared, 'entities', column, [])).toBe(true)
      expect(wroteField([update({ description: 'x' })], 'entities', column, [])).toBe(false)
    },
  )

  it('reads the flag columns together only on an entity', () => {
    const cleared = [update({ nameCollisionFlag: 1 })]
    expect(wroteField(cleared, 'other_table', 'nameCollisionReason', [])).toBe(false)
  })
})

describe('userDeletedPairSince', () => {
  it("matches a user delete of the pair's row and ignores another pair's delete", async () => {
    const { ctx } = await setup()
    await seedChars(ctx, 'char_kael', 'char_mira', 'char_zed')
    await apply(ctx, relate('char_kael', 'char_mira'), 'a0')
    await apply(ctx, relate('char_kael', 'char_zed'), 'a1')
    const since = await apply(ctx, createEntry('e_1', 1), 'a2')
    await apply(ctx, deletePair(await pairRowId(ctx, 'char_kael', 'char_zed')), 'a3')
    expect(await userDeletedPairSince(ctx, 'br_1', 'char_kael', 'char_zed', since)).toBe(true)
    expect(await userDeletedPairSince(ctx, 'br_1', 'char_kael', 'char_mira', since)).toBe(false)
  })

  it('ignores a user delete at or before the given position', async () => {
    const { ctx } = await setup()
    await seedChars(ctx, 'char_kael', 'char_mira')
    await apply(ctx, relate('char_kael', 'char_mira'), 'a0')
    const deleted = await apply(
      ctx,
      deletePair(await pairRowId(ctx, 'char_kael', 'char_mira')),
      'a1',
    )
    expect(await userDeletedPairSince(ctx, 'br_1', 'char_kael', 'char_mira', deleted)).toBe(false)
    expect(await userDeletedPairSince(ctx, 'br_1', 'char_kael', 'char_mira', deleted - 1)).toBe(
      true,
    )
  })
})
