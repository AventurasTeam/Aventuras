import type { DatabaseSync } from 'node:sqlite'

import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  emptyEntityState,
  ensureVecTablesSql,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  sourceHash,
  stories,
  storyEntries,
  translations,
  type CharacterState,
  type Delta,
  type Entity,
  type EntityKind,
  type EntityState,
  type EntryMetadata,
  type LocationState,
  type NewEntity,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { plantVec } from '@/lib/db/__tests__/vec-fixtures'
import { logger } from '@/lib/diagnostics'
import {
  characterRelationshipsStore,
  entitiesStore,
  generationStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
} from '@/lib/stores'
import { entityLinkRows } from '@/lib/world'

import { resolveCollision, type CollisionResolution } from './resolve-collision'
import { applyDeltaAction } from '../delta/apply-delta-action'
import {
  __resetBranchWriteLocks,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '../delta/branch-write-lock'
import { withKeyLock } from '../delta/key-lock'
import { applyRedo, prepareUndo } from '../delta/redo'
import { selectReversalSet } from '../delta/row-closure'
import { rowLock } from '../delta/row-locks'
import { deleteEntityRow } from '../row-delete/delete-entity'
import type { loadHeadTurn as LoadHeadTurn } from '../story-entries/head-turn'
import { updateEntrySceneFields } from '../story-entries/scene-fields'
import type { DbCtx } from '../types'

// Fires `onSecond` inside the SECOND `loadHeadTurn` call — the in-lock re-read — so a test can
// land a new tail exactly between the two reads.
const headTurnHook = vi.hoisted(() => ({
  calls: 0,
  onSecond: null as (() => Promise<void>) | null,
}))
vi.mock('../story-entries/head-turn', async (importOriginal) => {
  const real = (await importOriginal()) as { loadHeadTurn: typeof LoadHeadTurn }
  return {
    ...real,
    loadHeadTurn: async (...args: Parameters<typeof LoadHeadTurn>) => {
      headTurnHook.calls += 1
      if (headTurnHook.calls === 2 && headTurnHook.onSecond) await headTurnHook.onSecond()
      return real.loadHeadTurn(...args)
    },
  }
})

let ctx: DbCtx
let sqlite: DatabaseSync

function row(
  id: string,
  kind: EntityKind,
  name: string,
  createdAt: number,
  extra: Partial<NewEntity> = {},
): NewEntity {
  return {
    id,
    branchId: 'b1',
    kind,
    name,
    status: 'active',
    injectionMode: 'auto',
    state: emptyEntityState(kind),
    embeddingStale: 0,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  }
}

const characterState = (state: Partial<CharacterState>): CharacterState => ({
  ...emptyEntityState('character'),
  ...state,
})

function mergeInto(canonicalId: string, loserId: string): CollisionResolution {
  return { mode: 'merge', canonicalId, loserId, fromLoser: [], tags: [], keywords: [] }
}

const MERGE_B_INTO_A = mergeInto('char_a', 'char_b')
const KEEP_A_B: CollisionResolution = { mode: 'keep', ids: ['char_a', 'char_b'] }

function plantVectors(id: string): void {
  for (const dim of [384, 8]) {
    plantVec(sqlite, {
      kind: 'entity',
      id,
      branchId: 'b1',
      modelId: `m${dim}`,
      dim,
      sourceHash: sourceHash('h'),
      vector: new Uint8Array(new Float32Array(dim).buffer),
    })
  }
}

function vectorCount(id: string): number {
  const found = sqlite
    .prepare(
      'SELECT (SELECT count(*) FROM entities_vec_384 WHERE id = ?1) + (SELECT count(*) FROM entities_vec_8 WHERE id = ?1) AS n',
    )
    .get(id) as { n: number }
  return found.n
}

async function hydrateStores(): Promise<void> {
  entitiesStore.hydrate('b1', (await ctx.db.select().from(entities)) as never)
  happeningAwarenessStore.hydrate('b1', await ctx.db.select().from(happeningAwareness))
  happeningInvolvementsStore.hydrate('b1', await ctx.db.select().from(happeningInvolvements))
  characterRelationshipsStore.hydrate('b1', await ctx.db.select().from(characterRelationships))
}

async function setStatus(id: string, status: Entity['status']): Promise<void> {
  await ctx.db.update(entities).set({ status }).where(eq(entities.id, id))
  await hydrateStores()
}

async function setState(id: string, state: EntityState): Promise<void> {
  await ctx.db.update(entities).set({ state }).where(eq(entities.id, id))
  await hydrateStores()
}

async function setTail(metadata: EntryMetadata): Promise<void> {
  await ctx.db.update(storyEntries).set({ metadata }).where(eq(storyEntries.id, 'entry_2'))
}

async function setFlag(id: string, flag: 0 | 1): Promise<void> {
  await ctx.db.update(entities).set({ nameCollisionFlag: flag }).where(eq(entities.id, id))
  await hydrateStores()
}

async function entityRow(id: string): Promise<Entity | undefined> {
  const [found] = await ctx.db.select().from(entities).where(eq(entities.id, id))
  return found as Entity | undefined
}

async function characterStateOf(id: string): Promise<CharacterState> {
  return (await entityRow(id))?.state as CharacterState
}

async function tail(): Promise<EntryMetadata> {
  const [found] = await ctx.db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_2'))
  return found.metadata as EntryMetadata
}

async function deltaRows(): Promise<Delta[]> {
  return (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
}

async function undoAll() {
  const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltaRows() })
  const { group, reverse } = await prepareUndo(set, ctx)
  await reverse()
  return group
}

async function awarenessIds(): Promise<string[]> {
  return (await ctx.db.select().from(happeningAwareness)).map((r) => r.id).sort()
}

async function translationIds(): Promise<string[]> {
  return (await ctx.db.select().from(translations)).map((r) => r.id).sort()
}

async function relationshipRows() {
  return (await ctx.db.select().from(characterRelationships)).sort((x, y) =>
    x.id.localeCompare(y.id),
  )
}

function byId<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((x, y) => x.id.localeCompare(y.id))
}

// Every table a resolution writes; entities without the columns undo re-derives (stale, touched).
async function worldSnapshot() {
  const db = ctx.db
  return {
    entities: byId((await db.select().from(entities)) as Entity[]).map(
      ({ embeddingStale: _stale, updatedAt: _touched, ...rest }) => rest,
    ),
    awareness: byId(await db.select().from(happeningAwareness)),
    involvements: byId(await db.select().from(happeningInvolvements)),
    relationships: byId(await db.select().from(characterRelationships)),
    translations: byId(await db.select().from(translations)),
    entries: byId(
      await db.select({ id: storyEntries.id, metadata: storyEntries.metadata }).from(storyEntries),
    ),
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function startHardGateRun(): void {
  generationStore.startRun({
    runId: 'r1',
    kind: 'turn',
    gateBehavior: 'hard-gate',
    actionId: 'act_r1',
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: 'commit',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

beforeEach(async () => {
  headTurnHook.calls = 0
  headTurnHook.onSecond = null
  generationStore.__reset()
  __resetBranchWriteLocks()
  const test = await createTestDb()
  ctx = { db: test.db, runInTransaction: test.runInTransaction }
  sqlite = test.sqlite
  for (const ddl of ensureVecTablesSql(8)) sqlite.exec(ddl)
  const db = ctx.db
  await db.insert(stories).values({
    id: 's1',
    title: 'T',
    definition: { leadEntityId: 'char_lead' } as StoryDefinition,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(entities).values([
    row('char_lead', 'character', 'Kael', 1),
    row('char_kael2', 'character', 'Kael', 2, { nameCollisionFlag: 1 }),
    row('char_a', 'character', 'Brannoc', 1),
    row('char_b', 'character', 'Brannoc', 2, { nameCollisionFlag: 1 }),
    row('char_o', 'character', 'Vorne', 1, {
      state: characterState({ current_location_id: 'loc_b', inventory: ['item_b'] }),
    }),
    row('loc_a', 'location', 'Harbor', 1),
    row('loc_b', 'location', 'Harbor', 2, { nameCollisionFlag: 1 }),
    row('item_a', 'item', 'Lantern', 1),
    row('item_b', 'item', 'Lantern', 2, { nameCollisionFlag: 1 }),
  ])
  await db.insert(happenings).values([
    { id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 },
    { id: 'hap_2', branchId: 'b1', title: 'Flood', createdAt: 1, updatedAt: 1 },
    { id: 'hap_3', branchId: 'b1', title: 'Feast', createdAt: 1, updatedAt: 1 },
  ])
  await db.insert(happeningAwareness).values([
    {
      id: 'haw_a1',
      branchId: 'b1',
      happeningId: 'hap_1',
      characterId: 'char_a',
      retrievalCount: 2,
    },
    { id: 'haw_b1', branchId: 'b1', happeningId: 'hap_1', characterId: 'char_b' },
    {
      id: 'haw_b2',
      branchId: 'b1',
      happeningId: 'hap_2',
      characterId: 'char_b',
      retrievalCount: 7,
      source: 'witnessed',
      decayResistance: 0.5,
      learnedAtEntryId: 'entry_1',
    },
  ])
  await db.insert(happeningInvolvements).values({
    id: 'hinv_b1',
    branchId: 'b1',
    happeningId: 'hap_3',
    entityId: 'char_b',
    role: 'witness',
  })
  await db.insert(characterRelationships).values([
    {
      id: 'rel_ao',
      branchId: 'b1',
      aId: 'char_a',
      bId: 'char_o',
      kind: null,
      inverseKind: 'trusts',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'rel_bo',
      branchId: 'b1',
      aId: 'char_b',
      bId: 'char_o',
      kind: 'rival',
      inverseKind: 'wary',
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  await db.insert(translations).values([
    {
      id: 'tr_b',
      branchId: 'b1',
      targetKind: 'entity',
      targetId: 'char_b',
      field: 'name',
      language: 'cs',
      translatedText: 'x',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'tr_rel',
      branchId: 'b1',
      targetKind: 'character_relationship',
      targetId: 'rel_bo',
      field: 'kind',
      language: 'cs',
      translatedText: 'y',
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  const scene = {
    sceneEntities: ['char_b', 'char_o'],
    currentLocationId: 'loc_b',
    worldTime: 0,
  } as EntryMetadata
  await db.insert(storyEntries).values([
    {
      id: 'entry_1',
      branchId: 'b1',
      position: 1,
      kind: 'opening',
      content: 'Once.',
      metadata: scene,
      createdAt: 1,
    },
    {
      id: 'entry_2',
      branchId: 'b1',
      position: 2,
      kind: 'ai_reply',
      content: 'Then.',
      metadata: scene,
      createdAt: 2,
    },
  ])
  plantVectors('char_b')
  await hydrateStores()
})

describe('resolveCollision — merge', () => {
  it('moves B onto A under one action_id and leaves B gone with no vectors', async () => {
    await setFlag('char_a', 1)
    expect(vectorCount('char_b')).toBe(2)

    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toEqual({ status: 'ok' })

    expect(await entityRow('char_b')).toBeUndefined()
    expect(vectorCount('char_b')).toBe(0)
    expect((await entityRow('char_a'))?.nameCollisionFlag).toBe(0)

    const aware = await ctx.db.select().from(happeningAwareness)
    expect(aware.map((r) => r.characterId)).toEqual(['char_a', 'char_a'])
    // B's hap_1 row collided with A's: A's stays as it was, B's is dropped.
    expect(aware.find((r) => r.happeningId === 'hap_1')).toMatchObject({
      id: 'haw_a1',
      retrievalCount: 2,
    })
    expect(aware.find((r) => r.happeningId === 'hap_2')).toMatchObject({
      retrievalCount: 7,
      source: 'witnessed',
      decayResistance: 0.5,
      learnedAtEntryId: 'entry_1',
    })
    expect(await ctx.db.select().from(happeningInvolvements)).toMatchObject([
      { happeningId: 'hap_3', entityId: 'char_a', role: 'witness' },
    ])
    // A had a row with Vorne already: A's non-null view wins, B's fills A's empty one.
    expect(await relationshipRows()).toMatchObject([
      { id: 'rel_ao', aId: 'char_a', bId: 'char_o', kind: 'rival', inverseKind: 'trusts' },
    ])
    expect(await translationIds()).toEqual([])
    expect((await tail()).sceneEntities).toEqual(['char_a', 'char_o'])
    expect((await characterStateOf('char_a')).current_location_id).toBe('loc_b')

    const rows = await deltaRows()
    expect(new Set(rows.map((r) => r.actionId)).size).toBe(1)
    // A's two updates: the merge patch (flag), then the scene's tracking (location).
    expect(rows.map((r) => `${r.targetTable}:${r.op}`).sort()).toEqual([
      'character_relationships:update',
      'entities:delete',
      'entities:update',
      'entities:update',
      'happening_awareness:create',
      'happening_involvements:create',
      'story_entries:update',
    ])
  })

  it('CTRL-Z restores B with every row it held, re-flagged and stale; redo merges again', async () => {
    await setFlag('char_a', 1)
    const before = await worldSnapshot()
    await resolveCollision('b1', MERGE_B_INTO_A, ctx)
    const merged = await worldSnapshot()

    const group = await undoAll()

    expect(await worldSnapshot()).toEqual(before)

    expect(await entityRow('char_b')).toMatchObject({ nameCollisionFlag: 1, embeddingStale: 1 })
    expect((await entityRow('char_a'))?.nameCollisionFlag).toBe(1)
    expect(await awarenessIds()).toEqual(['haw_a1', 'haw_b1', 'haw_b2'])
    expect(
      (await ctx.db.select().from(happeningInvolvements)).map((r) => [r.id, r.entityId]),
    ).toEqual([['hinv_b1', 'char_b']])
    expect(await relationshipRows()).toMatchObject([
      { id: 'rel_ao', kind: null, inverseKind: 'trusts' },
      { id: 'rel_bo', kind: 'rival', inverseKind: 'wary' },
    ])
    expect(await translationIds()).toEqual(['tr_b', 'tr_rel'])
    expect((await tail()).sceneEntities).toEqual(['char_b', 'char_o'])

    plantVectors('char_b')
    await applyRedo(group, ctx)

    expect(await worldSnapshot()).toEqual(merged)
    expect(await entityRow('char_b')).toBeUndefined()
    expect(vectorCount('char_b')).toBe(0)
    expect((await ctx.db.select().from(happeningAwareness)).map((r) => r.characterId)).toEqual([
      'char_a',
      'char_a',
    ])
    expect(await relationshipRows()).toMatchObject([{ id: 'rel_ao', kind: 'rival' }])
    expect((await tail()).sceneEntities).toEqual(['char_a', 'char_o'])
  })

  it("waits out a scene edit holding the tail's lock, then plans from the edited scene", async () => {
    let release = () => {}
    const commitGate = new Promise<void>((resolve) => {
      release = resolve
    })
    let parked = false
    const gated: DbCtx = {
      ...ctx,
      runInTransaction: async (ops) => {
        if (!parked) {
          parked = true
          await commitGate
        }
        return ctx.runInTransaction(ops)
      },
    }

    const sceneEdit = updateEntrySceneFields(
      'b1',
      'entry_2',
      { sceneEntities: ['char_b', 'char_o', 'char_lead'] },
      gated,
    )
    await flush()
    expect(parked).toBe(true)
    let settled = false
    const merging = resolveCollision('b1', MERGE_B_INTO_A, gated).finally(() => {
      settled = true
    })
    await flush()
    expect(settled).toBe(false)
    release()

    expect(await sceneEdit).toEqual({ status: 'ok' })
    expect(await merging).toEqual({ status: 'ok' })
    expect([...(await tail()).sceneEntities].sort()).toEqual(['char_a', 'char_lead', 'char_o'])
  })

  it('refuses parent-chain-broken when a rewritten parent leads into a stored loop', async () => {
    await ctx.db.insert(entities).values([
      row('loc_x', 'location', 'Cove', 1, {
        state: { parent_location_id: 'loc_y' } satisfies LocationState,
      }),
      row('loc_y', 'location', 'Reef', 1, {
        state: { parent_location_id: 'loc_x' } satisfies LocationState,
      }),
      row('loc_c', 'location', 'Pier', 1, {
        state: { parent_location_id: 'loc_b' } satisfies LocationState,
      }),
    ])
    await ctx.db
      .update(entities)
      .set({ state: { parent_location_id: 'loc_x' } satisfies LocationState })
      .where(eq(entities.id, 'loc_a'))
    await hydrateStores()

    expect(await resolveCollision('b1', mergeInto('loc_a', 'loc_b'), ctx)).toMatchObject({
      status: 'rejected',
      code: 'parent-chain-broken',
    })
    expect(await deltaRows()).toEqual([])
  })

  it("deletes exactly B's link rows through the cascade, the rows the plan moved", async () => {
    const linkIds = async () => [
      ...(await ctx.db.select().from(happeningAwareness)).map((r) => r.id),
      ...(await ctx.db.select().from(happeningInvolvements)).map((r) => r.id),
      ...(await ctx.db.select().from(characterRelationships)).map((r) => r.id),
    ]
    const before = await linkIds()
    const links = entityLinkRows({
      branchId: 'b1',
      id: 'char_b',
      awareness: await ctx.db.select().from(happeningAwareness),
      involvements: await ctx.db.select().from(happeningInvolvements),
      relationships: await ctx.db.select().from(characterRelationships),
    })

    await resolveCollision('b1', MERGE_B_INTO_A, ctx)

    const after = new Set(await linkIds())
    expect(before.filter((id) => !after.has(id)).sort()).toEqual(
      [...links.awareness, ...links.involvements, ...links.relationships].map((r) => r.id).sort(),
    )
  })

  it('rewrites an inventory ref to the surviving item in one update', async () => {
    expect(await resolveCollision('b1', mergeInto('item_a', 'item_b'), ctx)).toEqual({
      status: 'ok',
    })

    expect((await characterStateOf('char_o')).inventory).toEqual(['item_a'])
    expect((await deltaRows()).filter((r) => r.targetId === 'char_o')).toHaveLength(1)
  })

  it('rewrites current_location_id and the tail location to the surviving location; CTRL-Z puts them back', async () => {
    expect(await resolveCollision('b1', mergeInto('loc_a', 'loc_b'), ctx)).toEqual({
      status: 'ok',
    })

    expect((await characterStateOf('char_o')).current_location_id).toBe('loc_a')
    expect((await deltaRows()).filter((r) => r.targetId === 'char_o')).toHaveLength(1)
    expect((await tail()).currentLocationId).toBe('loc_a')

    await undoAll()

    expect((await characterStateOf('char_o')).current_location_id).toBe('loc_b')
    expect((await tail()).currentLocationId).toBe('loc_b')
    expect((await entityRow('loc_b'))?.nameCollisionFlag).toBe(1)
  })

  it('refuses a merge whose loser is the lead with lead-entity, before any write', async () => {
    expect(await resolveCollision('b1', mergeInto('char_kael2', 'char_lead'), ctx)).toMatchObject({
      status: 'rejected',
      code: 'lead-entity',
    })
    expect(await deltaRows()).toEqual([])
  })

  it('refuses parent-cycle when the canonical descends from the loser', async () => {
    await ctx.db.insert(entities).values(
      row('loc_m', 'location', 'Dock', 1, {
        state: { parent_location_id: 'loc_b' } satisfies LocationState,
      }),
    )
    await ctx.db
      .update(entities)
      .set({ state: { parent_location_id: 'loc_m' } satisfies LocationState })
      .where(eq(entities.id, 'loc_a'))
    await hydrateStores()

    expect(await resolveCollision('b1', mergeInto('loc_a', 'loc_b'), ctx)).toMatchObject({
      status: 'rejected',
      code: 'parent-cycle',
    })
    expect(await deltaRows()).toEqual([])
  })

  it('refuses in-flight when a new tail lands while it takes the tail lock', async () => {
    headTurnHook.onSecond = async () => {
      await ctx.db.insert(storyEntries).values({
        id: 'entry_3',
        branchId: 'b1',
        position: 3,
        kind: 'ai_reply',
        content: 'Now.',
        metadata: {
          sceneEntities: ['char_b'],
          currentLocationId: null,
          worldTime: 0,
        } as EntryMetadata,
        createdAt: 3,
      })
    }

    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toMatchObject({
      status: 'rejected',
      code: 'in-flight',
    })
    expect(await deltaRows()).toEqual([])
  })

  it('refuses in-flight when a hard-gate run starts while it takes the tail lock', async () => {
    headTurnHook.onSecond = async () => startHardGateRun()

    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toMatchObject({
      status: 'rejected',
      code: 'in-flight',
    })
    expect(await deltaRows()).toEqual([])
  })

  it('plans from the stores only after a no-gate pass holding the branch lock has written', async () => {
    await holdBranchWriteExclusive('b1', 'act_pass')
    let settled = false
    const merging = resolveCollision('b1', MERGE_B_INTO_A, ctx).finally(() => {
      settled = true
    })
    await flush()
    await flush()
    expect(settled).toBe(false)

    const written = await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'periodic_classifier',
          payload: { branchId: 'b1', characterId: 'char_b', happeningId: 'hap_3' },
        },
        actionId: 'act_pass',
        branchId: 'b1',
      },
      ctx,
    )
    expect(written.status).toBe('ok')
    releaseBranchWriteExclusive('b1', 'act_pass')

    expect(await merging).toEqual({ status: 'ok' })
    // A plan built before the hold released would miss this row, and B's delete would cascade it.
    const onA = await ctx.db
      .select()
      .from(happeningAwareness)
      .where(eq(happeningAwareness.characterId, 'char_a'))
    expect(onA.map((r) => r.happeningId).sort()).toEqual(['hap_1', 'hap_2', 'hap_3'])
  })
})

describe('resolveCollision — merge seats the canonical in the tail scene', () => {
  const deltasOn = async (id: string) =>
    (await deltaRows()).filter((r) => r.targetId === id).map((r) => r.op)

  it('promotes a staged canonical under the one action_id; CTRL-Z re-stages it, redo is exact', async () => {
    await setStatus('char_a', 'staged')
    const before = await worldSnapshot()

    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toEqual({ status: 'ok' })
    const merged = await worldSnapshot()

    expect((await entityRow('char_a'))?.status).toBe('active')
    expect((await tail()).sceneEntities).toEqual(['char_a', 'char_o'])
    expect(new Set((await deltaRows()).map((r) => r.actionId)).size).toBe(1)

    const group = await undoAll()

    expect(await worldSnapshot()).toEqual(before)
    expect((await entityRow('char_a'))?.status).toBe('staged')

    await applyRedo(group, ctx)

    expect(await worldSnapshot()).toEqual(merged)
  })

  it("promotes the canonical when the loser's staged status was chosen", async () => {
    await setStatus('char_b', 'staged')
    const resolution = { ...MERGE_B_INTO_A, fromLoser: ['status'] as const }

    expect(await resolveCollision('b1', resolution, ctx)).toEqual({ status: 'ok' })

    expect((await entityRow('char_a'))?.status).toBe('active')
  })

  it("takes the loser's active status over a staged canonical without a second status write", async () => {
    await setStatus('char_a', 'staged')
    const resolution = { ...MERGE_B_INTO_A, fromLoser: ['status'] as const }

    expect(await resolveCollision('b1', resolution, ctx)).toEqual({ status: 'ok' })

    expect((await entityRow('char_a'))?.status).toBe('active')
  })

  it("keeps the loser's retired status over a staged canonical: only staged is promoted", async () => {
    await setStatus('char_a', 'staged')
    await setStatus('char_b', 'retired')
    const resolution = { ...MERGE_B_INTO_A, fromLoser: ['status'] as const }

    expect(await resolveCollision('b1', resolution, ctx)).toEqual({ status: 'ok' })

    expect((await entityRow('char_a'))?.status).toBe('retired')
  })

  it('promotes a staged canonical location the tail now stands at, and tracks no character', async () => {
    await setStatus('loc_a', 'staged')

    expect(await resolveCollision('b1', mergeInto('loc_a', 'loc_b'), ctx)).toEqual({
      status: 'ok',
    })

    expect((await entityRow('loc_a'))?.status).toBe('active')
    expect((await tail()).currentLocationId).toBe('loc_a')
    // The ref rewrite moves Vorne off the loser; nothing tracks char_b, in the scene at no location.
    expect((await characterStateOf('char_o')).current_location_id).toBe('loc_a')
    expect(await deltasOn('char_o')).toEqual(['update'])
    expect(await deltasOn('char_b')).toEqual([])
  })

  it("tracks the canonical at the tail's location and writes nothing to the deleted loser", async () => {
    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toEqual({ status: 'ok' })

    expect((await characterStateOf('char_a')).current_location_id).toBe('loc_b')
    expect(await deltasOn('char_b')).toEqual(['delete'])
  })

  it("leaves the canonical's location alone when the tail has none", async () => {
    await setTail({ sceneEntities: ['char_b', 'char_o'], currentLocationId: null, worldTime: 0 })
    await setState('char_a', characterState({ current_location_id: 'loc_a' }))

    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toEqual({ status: 'ok' })

    expect((await characterStateOf('char_a')).current_location_id).toBe('loc_a')
  })

  it("keeps an in-scene bystander's location edited away from the tail's", async () => {
    await setState(
      'char_o',
      characterState({ current_location_id: 'loc_a', inventory: ['item_b'] }),
    )

    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toEqual({ status: 'ok' })

    expect((await characterStateOf('char_o')).current_location_id).toBe('loc_a')
    expect(await deltasOn('char_o')).toEqual([])
  })

  it('leaves a staged bystander in the scene staged', async () => {
    await setStatus('char_o', 'staged')

    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toEqual({ status: 'ok' })

    expect((await entityRow('char_o'))?.status).toBe('staged')
  })

  it('does not re-anchor a character who left the scene at the tail', async () => {
    await ctx.db
      .update(storyEntries)
      .set({
        metadata: {
          sceneEntities: ['char_b', 'char_o', 'char_kael2'],
          currentLocationId: 'loc_b',
          worldTime: 0,
        } as EntryMetadata,
      })
      .where(eq(storyEntries.id, 'entry_1'))
    await setState('char_kael2', characterState({ current_location_id: 'loc_a' }))

    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toEqual({ status: 'ok' })

    expect(await characterStateOf('char_kael2')).toMatchObject({
      current_location_id: 'loc_a',
      lastSeenAt: null,
    })
    expect(await deltasOn('char_kael2')).toEqual([])
  })

  it('tracks nothing when the canonical alone is in the tail scene', async () => {
    await setTail({ sceneEntities: ['char_a', 'char_o'], currentLocationId: 'loc_b', worldTime: 0 })
    await setState('char_a', characterState({ current_location_id: 'loc_a' }))

    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toEqual({ status: 'ok' })

    expect((await characterStateOf('char_a')).current_location_id).toBe('loc_a')
  })

  it('promotes nothing when the tail does not name the loser', async () => {
    await setStatus('item_a', 'staged')

    expect(await resolveCollision('b1', mergeInto('item_a', 'item_b'), ctx)).toEqual({
      status: 'ok',
    })

    expect((await entityRow('item_a'))?.status).toBe('staged')
  })
})

describe('resolveCollision — rename', () => {
  it('renames only B and clears its flag in that same delta', async () => {
    expect(
      await resolveCollision(
        'b1',
        { mode: 'rename', ids: ['char_a', 'char_b'], names: ['Brannoc', ' Brannoc the Younger '] },
        ctx,
      ),
    ).toEqual({ status: 'ok' })

    expect(await entityRow('char_b')).toMatchObject({
      name: 'Brannoc the Younger',
      nameCollisionFlag: 0,
    })
    const rows = await deltaRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      targetTable: 'entities',
      targetId: 'char_b',
      op: 'update',
      undoPayload: { name: 'Brannoc', nameCollisionFlag: 1 },
    })
  })

  it('CTRL-Z restores both names and flags; redo renames and clears again', async () => {
    await setFlag('char_a', 1)
    const before = await worldSnapshot()
    await resolveCollision(
      'b1',
      { mode: 'rename', ids: ['char_a', 'char_b'], names: ['Brannoc', 'Brannoc the Younger'] },
      ctx,
    )
    const renamed = await worldSnapshot()
    expect(await entityRow('char_a')).toMatchObject({ name: 'Brannoc', nameCollisionFlag: 0 })
    expect(await entityRow('char_b')).toMatchObject({
      name: 'Brannoc the Younger',
      nameCollisionFlag: 0,
    })

    const group = await undoAll()

    expect(await worldSnapshot()).toEqual(before)
    expect(await entityRow('char_b')).toMatchObject({ name: 'Brannoc', nameCollisionFlag: 1 })
    expect((await entityRow('char_a'))?.nameCollisionFlag).toBe(1)

    await applyRedo(group, ctx)

    expect(await worldSnapshot()).toEqual(renamed)
  })

  it.each([
    ['a case-only rename', 'BRANNOC'],
    ['an empty name', '   '],
  ])('refuses %s with invalid-rename and writes nothing', async (_, name) => {
    expect(
      await resolveCollision(
        'b1',
        { mode: 'rename', ids: ['char_a', 'char_b'], names: ['Brannoc', name] },
        ctx,
      ),
    ).toMatchObject({ status: 'rejected', code: 'invalid-rename' })
    expect(await deltaRows()).toEqual([])
  })
})

describe('resolveCollision — keep as distinct', () => {
  it('clears the flag on each flagged row of the pair; CTRL-Z re-flags both', async () => {
    await setFlag('char_a', 1)

    expect(await resolveCollision('b1', KEEP_A_B, ctx)).toEqual({ status: 'ok' })

    const rows = await deltaRows()
    expect(rows.map((r) => r.targetId).sort()).toEqual(['char_a', 'char_b'])
    expect(new Set(rows.map((r) => r.actionId)).size).toBe(1)
    expect((await entityRow('char_a'))?.nameCollisionFlag).toBe(0)
    expect((await entityRow('char_b'))?.nameCollisionFlag).toBe(0)

    await undoAll()

    expect((await entityRow('char_a'))?.nameCollisionFlag).toBe(1)
    expect((await entityRow('char_b'))?.nameCollisionFlag).toBe(1)
  })

  it('writes one delta when only one row of the pair is flagged', async () => {
    await resolveCollision('b1', KEEP_A_B, ctx)
    expect((await deltaRows()).map((r) => r.targetId)).toEqual(['char_b'])
  })
})

describe('resolveCollision — refusals', () => {
  it('refuses in-flight while a hard-gate run is active, writing nothing', async () => {
    startHardGateRun()
    expect(await resolveCollision('b1', KEEP_A_B, ctx)).toMatchObject({
      status: 'rejected',
      code: 'in-flight',
    })
    expect(await deltaRows()).toEqual([])
  })

  it('reports a prose reversal that starts while it waits on a row lock as in-flight', async () => {
    const warn = vi.spyOn(logger, 'warn')
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const held = withKeyLock(rowLock('entities')({ branchId: 'b1', id: 'char_b' }), () => gate)
    const pending = resolveCollision('b1', KEEP_A_B, ctx)
    await flush()
    generationStore.setReversalInProgress(true)
    try {
      release()
      await held

      expect(await pending).toMatchObject({ status: 'rejected', code: 'in-flight' })
      expect(await deltaRows()).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        'action_layer.collision_resolve_rejected',
        expect.objectContaining({ code: 'in-flight', rawCode: 'reversal-in-progress' }),
      )
    } finally {
      generationStore.setReversalInProgress(false)
      warn.mockRestore()
    }
  })

  it('refuses a merge in-flight before it reads the tail while a hard-gate run is active', async () => {
    startHardGateRun()
    expect(await resolveCollision('b1', MERGE_B_INTO_A, ctx)).toMatchObject({
      status: 'rejected',
      code: 'in-flight',
    })
    expect(headTurnHook.calls).toBe(0)
    expect(await deltaRows()).toEqual([])
  })

  it('reports a refusal with no collision code as failed', async () => {
    const warn = vi.spyOn(logger, 'warn')
    try {
      // The store still holds Vorne, so the plan rewrites a holder the update arm can't find.
      sqlite.exec(`DELETE FROM entities WHERE id = 'char_o'`)

      expect(await resolveCollision('b1', mergeInto('item_a', 'item_b'), ctx)).toMatchObject({
        status: 'rejected',
        code: 'failed',
      })
      expect(await deltaRows()).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        'action_layer.collision_resolve_rejected',
        expect.objectContaining({
          code: 'failed',
          reason: 'update target entities b1:char_o not found',
        }),
      )
      expect(warn.mock.calls[0][1]).not.toHaveProperty('rawCode')
    } finally {
      warn.mockRestore()
    }
  })

  it('logs and rethrows a failed transaction', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const failing: DbCtx = {
      ...ctx,
      runInTransaction: async () => {
        throw new Error('disk full')
      },
    }
    try {
      await expect(resolveCollision('b1', KEEP_A_B, failing)).rejects.toThrow('disk full')
      expect(error).toHaveBeenCalledWith(
        'action_layer.collision_resolve_failed',
        expect.objectContaining({ error: 'disk full' }),
      )
    } finally {
      error.mockRestore()
    }
  })

  it('refuses not-found when a row of the pair was deleted', async () => {
    await deleteEntityRow('b1', 'char_b', ctx)
    const before = (await deltaRows()).length

    expect(await resolveCollision('b1', KEEP_A_B, ctx)).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    })
    expect(await deltaRows()).toHaveLength(before)
  })

  it('refuses not-found when both ids name the same row', async () => {
    expect(await resolveCollision('b1', mergeInto('char_b', 'char_b'), ctx)).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    })
    expect(await deltaRows()).toEqual([])
  })

  it('refuses not-found when the two rows no longer share a name', async () => {
    entitiesStore.patch('b1', { op: 'update', id: 'char_b', columns: { name: 'Bran' } })

    expect(await resolveCollision('b1', KEEP_A_B, ctx)).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    })
    expect(await deltaRows()).toEqual([])
  })
})
