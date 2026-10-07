import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { PipelineAction } from '@/lib/actions'
import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { resolveCollision } from '@/lib/actions/world/resolve-collision'
import {
  branches,
  characterRelationships,
  deltas,
  emptyEntityState,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  type DbCtx,
  type Entity,
  type EntityKind,
  type NewDelta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { generateId } from '@/lib/ids'
import {
  characterRelationshipsStore,
  entitiesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  resetAllStores,
} from '@/lib/stores'

import { humanizeDelta, type HumanizeContext } from './humanize'
import type { HistoryRow } from './link-rows'
import { loadHistoryChunk, type HistoryQuery } from './query'

let db: DbCtx['db']
let ctx: DbCtx

function delta(
  logPosition: number,
  op: NewDelta['op'],
  undoPayload: Record<string, unknown> | null,
  targetId = 'char_1',
  branchId = 'b1',
): NewDelta {
  return {
    id: `delta_${logPosition}`,
    branchId,
    entryId: null,
    actionId: `act_${logPosition}`,
    logPosition,
    source: 'user_edit',
    targetTable: 'entities',
    targetId,
    op,
    undoPayload,
    createdAt: logPosition,
  }
}

// Full pre-delete row (data-model.md → Delta storage economy), incl. a state.traits key —
// regression fixture pinning the op=update gate so field-search skips this delete echo.
const FULL_ROW_DELETE_PAYLOAD = {
  id: 'char_1',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  description: 'A ranger',
  status: 'active',
  retiredReason: null,
  injectionMode: 'auto',
  nameCollisionFlag: 0,
  state: {
    visual: {},
    traits: ['brave'],
    drives: [],
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    faction_id: null,
    lastSeenAt: null,
  },
  tags: [],
  keywords: [],
  priority: 0,
  embeddingStale: 1,
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(async () => {
  const test = await createTestDb()
  db = test.db
  ctx = { db: test.db, runInTransaction: test.runInTransaction }
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db
    .insert(deltas)
    .values([
      delta(1, 'create', null),
      delta(2, 'update', { state: { traits: ['brave'] } }),
      delta(3, 'update', { state: { drives: ['home'] } }),
      delta(4, 'update', { description: 'lists her traits' }),
      delta(5, 'update', { state: { voice: null } }),
      delta(6, 'delete', FULL_ROW_DELETE_PAYLOAD),
      delta(7, 'update', { state: { traits: [] } }, 'char_2'),
    ])
})

const base: HistoryQuery = {
  branchId: 'b1',
  targetTable: 'entities',
  targetId: 'char_1',
  sort: 'newest',
  cursor: null,
}
const positions = async (query: Partial<HistoryQuery>) =>
  (await loadHistoryChunk(db, { ...base, ...query })).rows.map((row) => row.delta.logPosition)

describe('loadHistoryChunk', () => {
  it("reads one target's rows newest first", async () => {
    expect(await positions({})).toEqual([6, 5, 4, 3, 2, 1])
  })

  it('finds updates touching a field path, never a delete that merely echoes it in the full row', async () => {
    expect(await positions({ search: 'state.traits' })).toEqual([2])
  })

  it('finds a path whose pre-change value was the null sentinel', async () => {
    expect(await positions({ search: 'state.voice' })).toEqual([5])
  })

  it('matches free text', async () => {
    expect(await positions({ search: 'traits' })).toEqual([4, 2])
  })

  it('resolves a typed field label to the paths it names, though the payload never spells it', async () => {
    await db.insert(deltas).values(delta(8, 'update', { state: { stackables: { arrows: 3 } } }))
    expect(await positions({ search: 'quantities' })).toEqual([8])
  })

  it('filters by op, and matches an op typed into search, never a delete row echoing it', async () => {
    expect(await positions({ op: 'delete' })).toEqual([6])
    expect(await positions({ search: 'create' })).toEqual([1])
  })

  it('matches a translated op / filter-chip / summary label typed into search', async () => {
    expect(await positions({ search: 'Created' })).toEqual([1])
    expect(await positions({ search: 'modified' })).toEqual([5, 4, 3, 2])
  })

  it('matches a whole update summary typed into search, narrowed to updates', async () => {
    await db
      .insert(deltas)
      .values(delta(9, 'update', { state: { traits: ['calm'], drives: ['vengeance'] } }))
    expect(await positions({ search: 'Modified Traits' })).toEqual([9, 2])
    expect(await positions({ search: 'modified traits, drives' })).toEqual([9])
    expect(await positions({ search: 'Traits' })).toEqual([9, 4, 2])
  })

  it('matches a typed summary on the field paths it names only, never on payload values', async () => {
    await db
      .insert(deltas)
      .values([
        delta(9, 'update', { state: { traits: ['calm'], drives: ['vengeance'] } }),
        delta(10, 'update', { description: 'Traits and Drives' }),
      ])
    expect(await positions({ search: 'Modified Traits, Drives' })).toEqual([9])
    expect(await positions({ search: 'Modified Traits, No such field' })).toEqual([])
  })

  it('finds every row by the summary it renders', async () => {
    await db
      .insert(deltas)
      .values(delta(9, 'update', { state: { traits: ['calm'], drives: ['vengeance'] } }))
    const { rows } = await loadHistoryChunk(db, base)
    const context: HumanizeContext = {
      targetTable: base.targetTable,
      targetName: 'Kael',
      otherName: () => null,
      entryLabel: () => null,
      nowMs: 0,
    }
    for (const row of rows) {
      const { summary } = humanizeDelta(row, context)
      expect({ summary, found: await positions({ search: summary }) }).toEqual({
        summary,
        found: expect.arrayContaining([row.delta.logPosition]),
      })
    }
  })

  it('pages by log position in either sort, and reports the end', async () => {
    const first = await loadHistoryChunk(db, { ...base, limit: 4 })
    expect(first.rows.map((row) => row.delta.logPosition)).toEqual([6, 5, 4, 3])
    const second = await loadHistoryChunk(db, { ...base, limit: 4, cursor: first.nextCursor })
    expect(second.rows.map((row) => row.delta.logPosition)).toEqual([2, 1])
    expect(second.nextCursor).toBeNull()
    expect(await positions({ sort: 'oldest', limit: 2 })).toEqual([1, 2])
  })

  it('reports no further cursor when a chunk exactly fills the limit', async () => {
    const result = await loadHistoryChunk(db, { ...base, limit: 6 })
    expect(result.rows.map((row) => row.delta.logPosition)).toEqual([6, 5, 4, 3, 2, 1])
    expect(result.nextCursor).toBeNull()
  })

  it('pages oldest-first forward with a cursor', async () => {
    const first = await loadHistoryChunk(db, { ...base, sort: 'oldest', limit: 4 })
    expect(first.rows.map((row) => row.delta.logPosition)).toEqual([1, 2, 3, 4])
    expect(first.nextCursor).toBe(4)
    const second = await loadHistoryChunk(db, {
      ...base,
      sort: 'oldest',
      limit: 4,
      cursor: first.nextCursor,
    })
    expect(second.rows.map((row) => row.delta.logPosition)).toEqual([5, 6])
    expect(second.nextCursor).toBeNull()
  })

  it('never crosses into another branch holding a delta with the same target id', async () => {
    await db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'alt', createdAt: 1 })
    await db
      .insert(deltas)
      .values(delta(99, 'update', { description: 'other branch' }, 'char_1', 'b2'))
    expect(await positions({})).toEqual([6, 5, 4, 3, 2, 1])
  })
})

describe('LIKE escaping', () => {
  it('treats a % in the term as a literal character, not a wildcard', async () => {
    await db
      .insert(deltas)
      .values([
        delta(20, 'update', { description: 'Buy one, get 50% off' }),
        delta(21, 'update', { description: '50 items counted' }),
      ])
    expect(await positions({ search: '50%' })).toEqual([20])
  })

  it('treats a _ in the term as a literal character, not a single-char wildcard', async () => {
    await db
      .insert(deltas)
      .values([
        delta(22, 'update', { description: 'file_name here' }),
        delta(23, 'update', { description: 'fileXname here' }),
      ])
    expect(await positions({ search: 'file_name' })).toEqual([22])
  })

  it('matches text the payload stores JSON-escaped, and a bare quote only where a value holds one', async () => {
    await db
      .insert(deltas)
      .values([
        delta(24, 'update', { description: 'she said "hi"' }),
        delta(25, 'update', { description: 'C:\\maps\\north' }),
      ])
    expect(await positions({ search: '"hi"' })).toEqual([24])
    expect(await positions({ search: '"' })).toEqual([24])
    expect(await positions({ search: 'C:\\maps' })).toEqual([25])
  })
})

describe('payload meta keys', () => {
  it('never matches a meta key or its value, only the columns beside it', async () => {
    await db
      .insert(deltas)
      .values(delta(30, 'update', { description: 'moonlit', $firstLoggedAt: 987654 }))
    expect(await positions({ search: 'logged' })).toEqual([])
    expect(await positions({ search: '987654' })).toEqual([])
    expect(await positions({ search: 'moonlit' })).toEqual([30])
  })
})

// The union's writes go through the real arms, so payloads, ids and cascades are the shipped ones.
const BRANCH = 'b1'

function entity(
  id: string,
  kind: EntityKind,
  name: string,
  extra: Partial<NewEntity> = {},
): NewEntity {
  return {
    id,
    branchId: BRANCH,
    kind,
    name,
    status: 'active',
    injectionMode: 'auto',
    state: emptyEntityState(kind),
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

async function write(action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId: generateId('act'), branchId: BRANCH },
    ctx,
  )
  if (result.status !== 'ok') throw new Error(`${action.kind} refused: ${result.reason}`)
}

const relate = (
  subjectId: string,
  objectId: string,
  kind: string | null,
  inverseKind: string | null,
): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'user_edit',
  payload: { branchId: BRANCH, subjectId, objectId, kind, inverseKind },
})

const unrelate = (id: string): PipelineAction => ({
  kind: 'deleteCharacterRelationship',
  source: 'user_edit',
  payload: { branchId: BRANCH, id },
})

const aware = (
  characterId: string,
  happeningId: string,
  fields: { decayResistance?: number; source?: string } = {},
): PipelineAction => ({
  kind: 'upsertHappeningAwareness',
  source: 'user_edit',
  payload: { branchId: BRANCH, characterId, happeningId, ...fields },
})

const unaware = (id: string): PipelineAction => ({
  kind: 'deleteHappeningAwareness',
  source: 'user_edit',
  payload: { branchId: BRANCH, id },
})

const bump = (id: string, priorCount: number): PipelineAction => ({
  kind: 'bumpAwarenessRetrieval',
  source: 'ai_classifier',
  payload: { branchId: BRANCH, id, priorCount },
})

const involve = (
  id: string,
  entityId: string,
  happeningId: string,
  role: string | null = null,
): PipelineAction => ({
  kind: 'createHappeningInvolvement',
  source: 'user_edit',
  payload: { entry: { id, branchId: BRANCH, happeningId, entityId, role } },
})

const recast = (id: string, role: string): PipelineAction => ({
  kind: 'updateHappeningInvolvement',
  source: 'user_edit',
  payload: { branchId: BRANCH, id, patch: { role } },
})

const uninvolve = (id: string): PipelineAction => ({
  kind: 'deleteHappeningInvolvement',
  source: 'user_edit',
  payload: { branchId: BRANCH, id },
})

const describeAs = (id: string, description: string): PipelineAction => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: BRANCH, id, patch: { description } },
})

const removeEntity = (id: string): PipelineAction => ({
  kind: 'deleteEntity',
  source: 'user_edit',
  payload: { branchId: BRANCH, id },
})

const removeHappening = (id: string): PipelineAction => ({
  kind: 'deleteHappening',
  source: 'user_edit',
  payload: { branchId: BRANCH, id },
})

async function relationshipId(aId: string, bId: string): Promise<string> {
  const [row] = await db
    .select({ id: characterRelationships.id })
    .from(characterRelationships)
    .where(and(eq(characterRelationships.aId, aId), eq(characterRelationships.bId, bId)))
  return row.id
}

async function awarenessId(characterId: string, happeningId: string): Promise<string> {
  const [row] = await db
    .select({ id: happeningAwareness.id })
    .from(happeningAwareness)
    .where(
      and(
        eq(happeningAwareness.characterId, characterId),
        eq(happeningAwareness.happeningId, happeningId),
      ),
    )
  return row.id
}

/** A union row in one line: how it reaches the tab, its table and op, and the other end. */
function sig({ delta: row, via }: HistoryRow): string {
  switch (via.kind) {
    case 'own':
      return `own ${row.op}`
    case 'link':
      return `${via.table} ${row.op} ${via.otherId}${via.side == null ? '' : ` ${via.side}`}`
    case 'removed':
      return `removed ${via.tables.join('+')} ${via.otherId}`
  }
}

const tabQuery = (targetId: string, query: Partial<HistoryQuery> = {}): HistoryQuery => ({
  branchId: BRANCH,
  targetTable: 'entities',
  targetId,
  sort: 'newest',
  cursor: null,
  ...query,
})

const tab = async (targetId: string, query: Partial<HistoryQuery> = {}) =>
  (await loadHistoryChunk(db, tabQuery(targetId, query))).rows.map(sig)

describe('link-row union', () => {
  // Ids sort char_abe < char_aria < char_kael < char_mira < char_zed, which fixes each pair's a/b.
  beforeEach(async () => {
    await db
      .insert(entities)
      .values([
        entity('char_abe', 'character', 'Abe'),
        entity('char_aria', 'character', 'Aria'),
        entity('char_kael', 'character', 'Kael'),
        entity('char_mira', 'character', 'Mira'),
        entity('char_zed', 'character', 'Zed'),
        entity('loc_keep', 'location', 'The Keep'),
      ])
    await db.insert(happenings).values([
      { id: 'hap_fire', branchId: BRANCH, title: 'The keep burns', createdAt: 1, updatedAt: 1 },
      { id: 'hap_flood', branchId: BRANCH, title: 'The flood', createdAt: 1, updatedAt: 1 },
      { id: 'hap_feast', branchId: BRANCH, title: 'The feast', createdAt: 1, updatedAt: 1 },
    ])
  })

  afterEach(() => {
    resetAllStores()
  })

  it("lists a live relationship's edits on both characters' tabs, in log order among the row's own deltas", async () => {
    await write(describeAs('char_aria', 'a ranger'))
    await write(relate('char_aria', 'char_kael', 'friend', 'rival'))
    await write(describeAs('char_aria', 'a tired ranger'))
    await write(relate('char_kael', 'char_aria', 'ally', 'friend'))
    expect(await tab('char_aria')).toEqual([
      'character_relationships update char_kael a',
      'own update',
      'character_relationships create char_kael a',
      'own update',
    ])
    expect(await tab('char_kael')).toEqual([
      'character_relationships update char_aria b',
      'character_relationships create char_aria b',
    ])
  })

  it('lists a relationship removed on its own, and the Deleted chip returns its delete first', async () => {
    await write(relate('char_aria', 'char_mira', 'mentor', null))
    await write(unrelate(await relationshipId('char_aria', 'char_mira')))
    expect(await tab('char_aria')).toEqual([
      'character_relationships delete char_mira a',
      'character_relationships create char_mira a',
    ])
    expect(await tab('char_mira')).toEqual([
      'character_relationships delete char_aria b',
      'character_relationships create char_aria b',
    ])
    expect(await tab('char_aria', { op: 'delete' })).toEqual([
      'character_relationships delete char_mira a',
    ])
  })

  it("lists a relationship removed with the other character's delete, and that delete once", async () => {
    await write(relate('char_aria', 'char_zed', 'brother', 'sister'))
    await write(relate('char_aria', 'char_zed', 'stranger', 'sister'))
    await write(removeEntity('char_zed'))
    const chunk = await loadHistoryChunk(db, tabQuery('char_aria'))
    expect(chunk.rows.map(sig)).toEqual([
      'removed character_relationships char_zed',
      'character_relationships update char_zed a',
      'character_relationships create char_zed a',
    ])
    expect(chunk.names).toEqual({ char_zed: 'Zed' })
  })

  it("lists a character's awareness rows live, removed on their own and with the happening, without retrieval bumps", async () => {
    await write(aware('char_aria', 'hap_fire'))
    const fire = await awarenessId('char_aria', 'hap_fire')
    await write(aware('char_aria', 'hap_fire', { decayResistance: 0.8 }))
    await write(bump(fire, 0))
    await write(aware('char_aria', 'hap_feast'))
    await write(unaware(await awarenessId('char_aria', 'hap_feast')))
    await write(aware('char_aria', 'hap_flood'))
    await write(removeHappening('hap_flood'))
    const chunk = await loadHistoryChunk(db, tabQuery('char_aria'))
    expect(chunk.rows.map(sig)).toEqual([
      'removed happening_awareness hap_flood',
      'happening_awareness create hap_flood',
      'happening_awareness delete hap_feast',
      'happening_awareness create hap_feast',
      'happening_awareness update hap_fire',
      'happening_awareness create hap_fire',
    ])
    expect(chunk.names).toEqual({
      hap_fire: 'The keep burns',
      hap_feast: 'The feast',
      hap_flood: 'The flood',
    })
  })

  it('lists an awareness update that changed more than its retrieval count', async () => {
    await write(aware('char_aria', 'hap_fire'))
    await db.insert(deltas).values({
      id: 'delta_mixed',
      branchId: BRANCH,
      entryId: null,
      actionId: 'act_mixed',
      logPosition: 1000,
      source: 'user_edit',
      targetTable: 'happening_awareness',
      targetId: await awarenessId('char_aria', 'hap_fire'),
      op: 'update',
      undoPayload: { retrievalCount: 0, source: null },
      createdAt: 1000,
    })
    const chunk = await loadHistoryChunk(db, tabQuery('char_aria'))
    expect(chunk.rows.map(sig)).toEqual([
      'happening_awareness update hap_fire',
      'happening_awareness create hap_fire',
    ])
    const context: HumanizeContext = {
      targetTable: 'entities',
      targetName: 'Aria',
      otherName: (id) => chunk.names[id] ?? null,
      entryLabel: () => null,
      nowMs: 0,
    }
    expect(humanizeDelta(chunk.rows[0], context).summary).toBe('Modified Retrieval count, Source')
  })

  it("lists any entity's involvements live, removed on their own and with the happening", async () => {
    await write(involve('hinv_1', 'loc_keep', 'hap_fire', 'site'))
    await write(recast('hinv_1', 'ruin'))
    await write(involve('hinv_2', 'loc_keep', 'hap_feast'))
    await write(uninvolve('hinv_2'))
    await write(involve('hinv_3', 'loc_keep', 'hap_flood'))
    await write(removeHappening('hap_flood'))
    expect(await tab('loc_keep')).toEqual([
      'removed happening_involvements hap_flood',
      'happening_involvements create hap_flood',
      'happening_involvements delete hap_feast',
      'happening_involvements create hap_feast',
      'happening_involvements update hap_fire',
      'happening_involvements create hap_fire',
    ])
  })

  it("lists a happening's involvement and awareness rows live, removed on their own and with an entity, that delete once", async () => {
    await write(involve('hinv_1', 'char_kael', 'hap_fire', 'witness'))
    await write(aware('char_kael', 'hap_fire'))
    await write(recast('hinv_1', 'bystander'))
    await write(involve('hinv_3', 'char_mira', 'hap_fire'))
    await write(uninvolve('hinv_3'))
    await write(aware('char_mira', 'hap_fire'))
    await write(unaware(await awarenessId('char_mira', 'hap_fire')))
    await write(involve('hinv_2', 'char_zed', 'hap_fire', 'arsonist'))
    await write(aware('char_zed', 'hap_fire', { source: 'saw it' }))
    await write(removeEntity('char_zed'))
    const chunk = await loadHistoryChunk(db, tabQuery('hap_fire', { targetTable: 'happenings' }))
    expect(chunk.rows.map(sig)).toEqual([
      'removed happening_involvements+happening_awareness char_zed',
      'happening_awareness create char_zed',
      'happening_involvements create char_zed',
      'happening_awareness delete char_mira',
      'happening_awareness create char_mira',
      'happening_involvements delete char_mira',
      'happening_involvements create char_mira',
      'happening_involvements update char_kael',
      'happening_awareness create char_kael',
      'happening_involvements create char_kael',
    ])
    expect(chunk.names).toEqual({ char_kael: 'Kael', char_mira: 'Mira', char_zed: 'Zed' })
    expect(await tab('hap_fire', { targetTable: 'happenings', search: 'links' })).toEqual([
      'removed happening_involvements+happening_awareness char_zed',
    ])
    // A removal reading "Links" is still found by the label of any link kind it held.
    expect(await tab('hap_fire', { targetTable: 'happenings', search: 'involvement' })).toEqual([
      'removed happening_involvements+happening_awareness char_zed',
      'happening_involvements create char_zed',
      'happening_involvements delete char_mira',
      'happening_involvements create char_mira',
      'happening_involvements update char_kael',
      'happening_involvements create char_kael',
    ])
  })

  it("finds an involvement's and an awareness row's edits by their own labels, typed or summarised", async () => {
    await write(involve('hinv_1', 'loc_keep', 'hap_fire', 'site'))
    await write(recast('hinv_1', 'ruin'))
    expect(await tab('loc_keep', { search: 'Modified Role' })).toEqual([
      'happening_involvements update hap_fire',
    ])
    await write(aware('char_aria', 'hap_fire'))
    await write(aware('char_aria', 'hap_fire', { decayResistance: 0.8 }))
    expect(await tab('char_aria', { search: 'decay resistance' })).toEqual([
      'happening_awareness update hap_fire',
    ])
    expect(await tab('char_aria', { search: 'Modified Decay resistance' })).toEqual([
      'happening_awareness update hap_fire',
    ])
  })

  it("a merged pair: the canonical lists the moved rows' creates, the other ends keep the originals' history and the removal", async () => {
    await db
      .insert(entities)
      .values([
        entity('char_a', 'character', 'Brannoc'),
        entity('char_b', 'character', 'Brannoc', { nameCollisionFlag: 1, createdAt: 2 }),
      ])
    await write(relate('char_b', 'char_kael', 'friend', 'rival'))
    await write(relate('char_b', 'char_kael', 'brother', 'rival'))
    await write(aware('char_b', 'hap_fire'))
    await write(involve('hinv_b', 'char_b', 'hap_fire', 'witness'))
    entitiesStore.hydrate(BRANCH, (await db.select().from(entities)) as Entity[])
    happeningAwarenessStore.hydrate(BRANCH, await db.select().from(happeningAwareness))
    happeningInvolvementsStore.hydrate(BRANCH, await db.select().from(happeningInvolvements))
    characterRelationshipsStore.hydrate(BRANCH, await db.select().from(characterRelationships))

    expect(
      await resolveCollision(
        BRANCH,
        {
          mode: 'merge',
          canonicalId: 'char_a',
          loserId: 'char_b',
          fromLoser: [],
          tags: [],
          keywords: [],
        },
        ctx,
      ),
    ).toEqual({ status: 'ok' })

    expect(await tab('char_a')).toEqual([
      'character_relationships create char_kael a',
      'happening_involvements create hap_fire',
      'happening_awareness create hap_fire',
    ])
    const kael = await loadHistoryChunk(db, tabQuery('char_kael'))
    expect(kael.rows.map(sig)).toEqual([
      'removed character_relationships char_b',
      'character_relationships create char_a b',
      'character_relationships update char_b b',
      'character_relationships create char_b b',
    ])
    expect(kael.names).toEqual({ char_a: 'Brannoc', char_b: 'Brannoc' })
    expect(await tab('hap_fire', { targetTable: 'happenings' })).toEqual([
      'removed happening_involvements+happening_awareness char_b',
      'happening_involvements create char_a',
      'happening_awareness create char_a',
      'happening_involvements create char_b',
      'happening_awareness create char_b',
    ])
  })

  describe('search, op filter and paging over the union', () => {
    // Aria's tab, newest first: Zed's delete, Aria–Zed create, the fire awareness create,
    // Abe–Aria update and create, Aria–Kael update and create.
    beforeEach(async () => {
      await write(relate('char_aria', 'char_kael', 'friend', 'rival'))
      await write(relate('char_aria', 'char_kael', 'sister', 'rival'))
      await write(relate('char_abe', 'char_aria', 'boss', 'clerk'))
      await write(relate('char_aria', 'char_abe', 'rival', 'boss'))
      await write(aware('char_aria', 'hap_fire'))
      await write(relate('char_aria', 'char_zed', 'brother', null))
      await write(removeEntity('char_zed'))
    })

    it("resolves a field label against the delta's own table, a relationship's by the tab's side", async () => {
      const ariasViews = [
        'character_relationships update char_abe b',
        'character_relationships update char_kael a',
      ]
      expect(await tab('char_aria', { search: 'your view' })).toEqual(ariasViews)
      expect(await tab('char_aria', { search: 'Modified Your view' })).toEqual(ariasViews)
      expect(await tab('char_aria', { search: 'their view' })).toEqual([])
      expect(await tab('char_kael', { search: 'their view' })).toEqual([
        'character_relationships update char_aria b',
      ])
    })

    it("matches a typed summary against each side's labels, never across sides", async () => {
      // Abe holds `kind` on Abe–Aria, so changing his view is "Their view" on Aria's tab.
      await write(relate('char_abe', 'char_aria', 'mentor', 'rival'))
      expect(await tab('char_aria', { search: 'Modified Their view' })).toEqual([
        'character_relationships update char_abe b',
      ])
      expect(await tab('char_aria', { search: 'Modified Your view' })).toEqual([
        'character_relationships update char_abe b',
        'character_relationships update char_kael a',
      ])
    })

    it("matches the target line by link label and by the other end's name, word-start", async () => {
      expect(await tab('char_aria', { search: 'relat' })).toEqual([
        'removed character_relationships char_zed',
        'character_relationships create char_zed a',
        'character_relationships update char_abe b',
        'character_relationships create char_abe b',
        'character_relationships update char_kael a',
        'character_relationships create char_kael a',
      ])
      expect(await tab('char_aria', { search: 'Aware' })).toEqual([
        'happening_awareness create hap_fire',
      ])
      expect(await tab('char_aria', { search: 'kae' })).toEqual([
        'character_relationships update char_kael a',
        'character_relationships create char_kael a',
      ])
      expect(await tab('char_aria', { search: 'zed' })).toEqual([
        'removed character_relationships char_zed',
        'character_relationships create char_zed a',
      ])
      expect(await tab('char_aria', { search: 'the keep' })).toEqual([
        'happening_awareness create hap_fire',
      ])
      expect(await tab('char_aria', { search: 'ael' })).toEqual([])
      expect(await tab('char_aria', { search: 'burns' })).toEqual([
        'happening_awareness create hap_fire',
      ])
      expect(await tab('char_aria', { search: 'urns' })).toEqual([])
    })

    it("matches free text in a link update's payload", async () => {
      expect(await tab('char_aria', { search: 'friend' })).toEqual([
        'character_relationships update char_kael a',
      ])
    })

    it('matches a removal by its summary typed whole, or by a word of it', async () => {
      await write(relate('char_aria', 'char_mira', 'mentor', null))
      await write(removeEntity('char_mira'))
      expect(await tab('char_aria', { search: 'Removed when Zed was deleted' })).toEqual([
        'removed character_relationships char_zed',
      ])
      expect(await tab('char_aria', { search: 'Removed when Ze' })).toEqual([
        'removed character_relationships char_zed',
      ])
      expect(await tab('char_aria', { search: 'Removed  when Zed' })).toEqual([
        'removed character_relationships char_zed',
      ])
      expect(await tab('char_aria', { search: 'removed' })).toEqual([
        'removed character_relationships char_mira',
        'removed character_relationships char_zed',
      ])
    })

    it('matches the unknown-end wording only to the removals whose other end has no name', async () => {
      await db.insert(deltas).values({
        id: 'delta_ghost',
        branchId: BRANCH,
        entryId: null,
        actionId: 'act_ghost',
        logPosition: 1000,
        source: 'user_edit',
        targetTable: 'entities',
        targetId: 'char_ghost',
        op: 'delete',
        undoPayload: {
          id: 'char_ghost',
          relationships: [
            {
              id: 'rel_ghost',
              branchId: BRANCH,
              aId: 'char_aria',
              bId: 'char_ghost',
              kind: 'ally',
              inverseKind: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        createdAt: 1000,
      })
      expect(await tab('char_aria', { search: 'Removed when its other end was deleted' })).toEqual([
        'removed character_relationships char_ghost',
      ])
    })

    it('finds every union row by the summary it renders', async () => {
      const chunk = await loadHistoryChunk(db, tabQuery('char_aria'))
      const context: HumanizeContext = {
        targetTable: 'entities',
        targetName: 'Aria',
        otherName: (id) => chunk.names[id] ?? null,
        entryLabel: () => null,
        nowMs: 0,
      }
      expect(chunk.rows).toHaveLength(7)
      for (const row of chunk.rows) {
        const { summary } = humanizeDelta(row, context)
        const found = await loadHistoryChunk(db, tabQuery('char_aria', { search: summary }))
        expect({ summary, found: found.rows.map((hit) => hit.delta.id) }).toEqual({
          summary,
          found: expect.arrayContaining([row.delta.id]),
        })
      }
    })

    it('applies the op chips to link rows and removals', async () => {
      expect(await tab('char_aria', { op: 'create' })).toEqual([
        'character_relationships create char_zed a',
        'happening_awareness create hap_fire',
        'character_relationships create char_abe b',
        'character_relationships create char_kael a',
      ])
      expect(await tab('char_aria', { op: 'delete' })).toEqual([
        'removed character_relationships char_zed',
      ])
    })

    it('pages the union by log position in either sort', async () => {
      const first = await loadHistoryChunk(db, tabQuery('char_aria', { limit: 4 }))
      expect(first.rows.map(sig)).toEqual([
        'removed character_relationships char_zed',
        'character_relationships create char_zed a',
        'happening_awareness create hap_fire',
        'character_relationships update char_abe b',
      ])
      const second = await loadHistoryChunk(
        db,
        tabQuery('char_aria', { limit: 4, cursor: first.nextCursor }),
      )
      expect(second.rows.map(sig)).toEqual([
        'character_relationships create char_abe b',
        'character_relationships update char_kael a',
        'character_relationships create char_kael a',
      ])
      expect(second.nextCursor).toBeNull()
      const oldest = await loadHistoryChunk(db, tabQuery('char_aria', { sort: 'oldest', limit: 4 }))
      expect(oldest.rows.map(sig)).toEqual([
        'character_relationships create char_kael a',
        'character_relationships update char_kael a',
        'character_relationships create char_abe b',
        'character_relationships update char_abe b',
      ])
      const rest = await loadHistoryChunk(
        db,
        tabQuery('char_aria', { sort: 'oldest', limit: 4, cursor: oldest.nextCursor }),
      )
      expect(rest.rows.map(sig)).toEqual([
        'happening_awareness create hap_fire',
        'character_relationships create char_zed a',
        'removed character_relationships char_zed',
      ])
    })
  })
})
