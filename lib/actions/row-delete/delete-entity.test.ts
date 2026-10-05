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
  type EntryMetadata,
  type NewEntity,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { plantVec } from '@/lib/db/__tests__/vec-fixtures'
import { entitiesStore, generationStore } from '@/lib/stores'

import { deleteEntityRow } from './delete-entity'
import { ROW_DELETE_REJECTION } from './delete-row'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { applyRedo, prepareUndo } from '../delta/redo'
import { selectReversalSet } from '../delta/row-closure'
import type { loadHeadTurn as LoadHeadTurn } from '../story-entries/head-turn'
import { updateEntrySceneFields } from '../story-entries/scene-fields'
import type { DbCtx } from '../types'

// Fires `onSecond` from inside the SECOND `loadHeadTurn` call of a test — the in-lock re-read —
// so a probe can land a concurrent write exactly in the window the fix closes.
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

const character = (id: string, name: string, state: Partial<CharacterState> = {}): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  state: { ...emptyEntityState('character'), ...state },
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
})

function insertVectors(): void {
  for (const dim of [384, 8]) {
    plantVec(sqlite, {
      kind: 'entity',
      id: 'char_x',
      branchId: 'b1',
      modelId: `m${dim}`,
      dim,
      sourceHash: sourceHash('h'),
      vector: new Uint8Array(new Float32Array(dim).buffer),
    })
  }
}

function vectorCount(): number {
  const rows = sqlite
    .prepare(
      `SELECT (SELECT count(*) FROM entities_vec_384 WHERE id = 'char_x') + (SELECT count(*) FROM entities_vec_8 WHERE id = 'char_x') AS n`,
    )
    .all() as { n: number }[]
  return rows[0].n
}

beforeEach(async () => {
  // A failing race test can leave a stale hard-gate run or hook state, cascading into later tests.
  headTurnHook.calls = 0
  headTurnHook.onSecond = null
  generationStore.__reset()
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
  await db
    .insert(entities)
    .values([
      character('char_lead', 'Kael'),
      character('char_x', 'Mira'),
      character('char_o', 'Vorne', { current_location_id: 'char_x', inventory: ['char_x'] }),
    ])
  await db.insert(happenings).values([
    { id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 },
    { id: 'hap_2', branchId: 'b1', title: 'Flood', createdAt: 1, updatedAt: 1 },
  ])
  await db.insert(happeningAwareness).values([
    { id: 'haw_1', branchId: 'b1', happeningId: 'hap_1', characterId: 'char_x' },
    { id: 'haw_2', branchId: 'b1', happeningId: 'hap_2', characterId: 'char_x' },
  ])
  await db
    .insert(happeningInvolvements)
    .values({ id: 'hinv_1', branchId: 'b1', happeningId: 'hap_1', entityId: 'char_x' })
  await db.insert(characterRelationships).values({
    id: 'rel_1',
    branchId: 'b1',
    aId: 'char_o',
    bId: 'char_x',
    kind: 'rival',
    inverseKind: null,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(translations).values({
    id: 'tr_1',
    branchId: 'b1',
    targetKind: 'entity',
    targetId: 'char_x',
    field: 'name',
    language: 'cs',
    translatedText: 'x',
    createdAt: 1,
    updatedAt: 1,
  })
  const scene: EntryMetadata = {
    sceneEntities: ['char_x', 'char_o'],
    currentLocationId: null,
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
  insertVectors()
  entitiesStore.hydrate('b1', (await db.select().from(entities)) as never)
})

async function otherState(): Promise<CharacterState> {
  const [row] = await ctx.db.select().from(entities).where(eq(entities.id, 'char_o'))
  return row.state as CharacterState
}

async function tailScene(): Promise<readonly string[]> {
  const [row] = await ctx.db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_2'))
  return (row.metadata as EntryMetadata).sceneEntities
}

async function linkCounts() {
  return {
    awareness: (await ctx.db.select().from(happeningAwareness)).length,
    involvements: (await ctx.db.select().from(happeningInvolvements)).length,
    relationships: (await ctx.db.select().from(characterRelationships)).length,
    translations: (await ctx.db.select().from(translations)).length,
  }
}

describe('deleteEntityRow — C3 acceptance', () => {
  it('deletes the cascade, rewrites refs in one update, drops the tail mention, sweeps vectors, under one action_id', async () => {
    expect(vectorCount()).toBe(2)
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })

    expect(await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))).toEqual([])
    expect(await linkCounts()).toEqual({
      awareness: 0,
      involvements: 0,
      relationships: 0,
      translations: 0,
    })
    expect(await otherState()).toMatchObject({ current_location_id: null, inventory: [] })
    expect(await tailScene()).toEqual(['char_o'])
    expect(vectorCount()).toBe(0)

    const rows = (await ctx.db.select().from(deltas)) as Delta[]
    expect(new Set(rows.map((r) => r.actionId)).size).toBe(1)
    expect(
      rows.filter((r) => r.targetTable === 'entities' && r.targetId === 'char_o'),
    ).toHaveLength(1)
  })

  it('undo restores everything stale; redo re-deletes and re-sweeps', async () => {
    await deleteEntityRow('b1', 'char_x', ctx)
    const rows = (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: rows })
    const { group, reverse } = await prepareUndo(set, ctx)
    await reverse()

    const [restored] = await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))
    expect(restored.embeddingStale).toBe(1)
    expect(await linkCounts()).toEqual({
      awareness: 2,
      involvements: 1,
      relationships: 1,
      translations: 1,
    })
    expect(await otherState()).toMatchObject({
      current_location_id: 'char_x',
      inventory: ['char_x'],
    })
    expect(await tailScene()).toEqual(['char_x', 'char_o'])

    insertVectors()
    expect(vectorCount()).toBe(2)
    await applyRedo(group, ctx)
    expect(await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))).toEqual([])
    expect(await linkCounts()).toEqual({
      awareness: 0,
      involvements: 0,
      relationships: 0,
      translations: 0,
    })
    expect(vectorCount()).toBe(0)
  })

  it('refuses the lead with lead-entity and writes nothing', async () => {
    expect(await deleteEntityRow('b1', 'char_lead', ctx)).toMatchObject({
      status: 'rejected',
      code: 'lead-entity',
    })
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it('leaves no orphan when a classifier pass writes after the delete', async () => {
    await deleteEntityRow('b1', 'char_x', ctx)
    const awareness = await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'periodic_classifier',
          payload: { branchId: 'b1', characterId: 'char_x', happeningId: 'hap_1' },
        },
        actionId: 'act_pass',
        branchId: 'b1',
      },
      ctx,
    )
    const relationship = await applyDeltaAction(
      {
        action: {
          kind: 'upsertCharacterRelationship',
          source: 'periodic_classifier',
          payload: {
            branchId: 'b1',
            subjectId: 'char_lead',
            objectId: 'char_x',
            kind: 'friend',
            proseEntryId: null,
          },
        },
        actionId: 'act_pass',
        branchId: 'b1',
      },
      ctx,
    )
    expect(awareness).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(relationship).toMatchObject({ status: 'rejected', code: 'noop' })
    expect(await linkCounts()).toMatchObject({ awareness: 0, relationships: 0 })
  })
})

describe('deleteEntityRow — races closed by the in-lock re-read', () => {
  it('a hard-gate run finishing during the in-lock head read keeps its state write', async () => {
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
    headTurnHook.onSecond = async () => {
      const written = await applyDeltaAction(
        {
          action: {
            kind: 'updateEntityInventory',
            source: 'piggyback_tagged_block',
            payload: { branchId: 'b1', id: 'char_o', inventory: ['char_x', 'item_y'] },
          },
          actionId: 'act_r1',
          branchId: 'b1',
        },
        ctx,
      )
      expect(written.status).toBe('ok')
      generationStore.finishRun('r1')
    }
    const result = await deleteEntityRow('b1', 'char_x', ctx)
    headTurnHook.onSecond = null
    expect(result).toEqual({ status: 'ok' })
    expect((await otherState()).inventory).toEqual(['item_y'])
  })

  it('a new tail landing between the outer and inner head reads is never edited under the stale lock', async () => {
    let sceneEdit: Promise<unknown> = Promise.resolve()
    headTurnHook.onSecond = async () => {
      await ctx.db.insert(storyEntries).values({
        id: 'entry_3',
        branchId: 'b1',
        position: 3,
        kind: 'ai_reply',
        content: 'Now.',
        metadata: {
          sceneEntities: ['char_x', 'char_o'],
          currentLocationId: null,
          worldTime: 0,
        } as EntryMetadata,
        createdAt: 3,
      })
      sceneEdit = updateEntrySceneFields(
        'b1',
        'entry_3',
        { sceneEntities: ['char_x', 'char_o', 'char_lead'] },
        ctx,
      )
    }
    const result = await deleteEntityRow('b1', 'char_x', ctx)
    const edit = await sceneEdit
    headTurnHook.onSecond = null
    const [row] = await ctx.db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_3'))

    const scene = (row.metadata as EntryMetadata).sceneEntities
    expect(edit).toEqual({ status: 'ok' })
    // No lost update: either the delete refused (the tail moved under it), or it ran
    // after the edit committed and so still dropped char_x from the edited scene.
    if (result.status === 'ok') {
      expect([...scene].sort()).toEqual(['char_lead', 'char_o'])
    } else {
      expect(result).toMatchObject({ code: ROW_DELETE_REJECTION.inFlight })
      expect([...scene].sort()).toEqual(['char_lead', 'char_o', 'char_x'])
    }
  })

  it("waits out a scene edit holding the tail's lock, then drops the target from the edited scene", async () => {
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
    const yieldToTimers = () => new Promise((resolve) => setTimeout(resolve, 0))

    const sceneEdit = updateEntrySceneFields(
      'b1',
      'entry_2',
      { sceneEntities: ['char_x', 'char_o', 'char_lead'] },
      gated,
    )
    await yieldToTimers()
    expect(parked).toBe(true)
    let deleteSettled = false
    const deletion = deleteEntityRow('b1', 'char_x', gated).finally(() => {
      deleteSettled = true
    })
    await yieldToTimers()
    expect(deleteSettled).toBe(false)
    release()

    expect(await sceneEdit).toEqual({ status: 'ok' })
    expect(await deletion).toEqual({ status: 'ok' })
    expect([...(await tailScene())].sort()).toEqual(['char_lead', 'char_o'])
  })
})
