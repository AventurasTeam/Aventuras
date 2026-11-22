import { and, desc, eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  parseRerunJournal,
  reversalJournals,
  stories,
  storyEntries,
  type CharacterState,
  type DbCtx,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  branchSnapshot,
  cloneBranch,
  seedCopyFixture,
  type TestDb,
} from '@/lib/db/__tests__/two-branch'
import { entitiesStore, entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { __resetBranchWriteLocks } from './branch-write-lock'
import { readCurrentRow } from './redo'
import { reverseAndPruneDeltaRows } from './reverse-replay'
import { selectReversalSet } from './row-closure'
import { shownCounts } from '../story-entries/__tests__/shown-counts'
import { rollbackToEntry } from '../story-entries/operational'
import { redoLastAction, undoLastAction } from '../story-entries/undo'
import type { PipelineAction } from '../types'

// After a copy every id repeats on both branches: each case writes on B and reads A, which holds
// the same ids (data-model.md → Branch model).
const STORY = 's_two'
const A = 'br_a'
const B = 'br_b'

const STATE: CharacterState = {
  visual: { attire: 'travel cloak' },
  traits: ['brave'],
  drives: [],
  voice: 'low and dry',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

let t: TestDb
let ctx: DbCtx

beforeEach(async () => {
  generationStore.__reset()
  undoRedoStore.clear()
  t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
})

afterEach(() => {
  __resetBranchWriteLocks()
  entitiesStore.__reset()
  entriesStore.__reset()
  generationStore.__reset()
  undoRedoStore.clear()
})

async function openOnA(): Promise<void> {
  await ctx.db.insert(stories).values({ id: STORY, title: 'Two', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values({ id: A, storyId: STORY, name: 'main', createdAt: 1 })
}

async function onA(actionId: string, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: A }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

async function deltasOn(branchId: string, ...actionIds: string[]): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, branchId), inArray(deltas.actionId, actionIds)))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

async function deltaOn(branchId: string, id: string): Promise<Delta | undefined> {
  const [row] = (await ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, branchId), eq(deltas.id, id)))) as Delta[]
  return row
}

async function reverseOn(branchId: string, target: readonly Delta[]): Promise<void> {
  await reverseAndPruneDeltaRows(await selectReversalSet(ctx, { branchId, target }), ctx, {
    keepRedoExact: false,
  })
}

const character = (id: string, over: Partial<NewEntity> = {}): NewEntity => ({
  id,
  branchId: A,
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

// The user's later view keeps the pass's pair, so reversing the pass re-owns its create; the
// delete of char_p holds the pair in its payload, which the reversal rewrites.
async function seedHeldPair(): Promise<void> {
  await openOnA()
  await ctx.db.insert(entities).values(character('char_y'))
  await onA('act_user0', {
    kind: 'createEntity',
    source: 'user_edit',
    payload: { entry: character('char_p') },
  })
  await onA('act_pass', {
    kind: 'upsertCharacterRelationship',
    source: 'periodic_classifier',
    payload: {
      branchId: A,
      subjectId: 'char_p',
      objectId: 'char_y',
      kind: 'rival',
      proseEntryId: null,
    },
  })
  await onA('act_user', {
    kind: 'upsertCharacterRelationship',
    source: 'user_edit',
    payload: {
      branchId: A,
      subjectId: 'char_p',
      objectId: 'char_y',
      kind: 'rival',
      inverseKind: 'mentor',
    },
  })
  await onA('act_del', {
    kind: 'deleteEntity',
    source: 'user_edit',
    payload: { branchId: A, id: 'char_p' },
  })
  cloneBranch(t.sqlite, A, B)
}

describe('delta writes on a copied branch', () => {
  it("undoLastAction on B prunes B's group and leaves A's deltas", async () => {
    await openOnA()
    await onA('act_0', {
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: character('char_kael', { description: 'a wandering knight' }) },
    })
    await onA('act_u', {
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId: A, id: 'char_kael', patch: { description: 'a sworn knight' } },
    })
    cloneBranch(t.sqlite, A, B)
    const aBefore = branchSnapshot(t.sqlite, A)
    entriesStore.hydrate(B, [])

    expect(await undoLastAction(B, ctx)).toEqual({ status: 'ok' })

    expect(await deltasOn(B, 'act_u')).toEqual([])
    const [kael] = await ctx.db
      .select()
      .from(entities)
      .where(and(eq(entities.branchId, B), eq(entities.id, 'char_kael')))
    expect(kael.description).toBe('a wandering knight')
    expect(await deltasOn(A, 'act_u')).toHaveLength(1)
    expect(branchSnapshot(t.sqlite, A)).toEqual(aBefore)
  })

  it("a re-own on B rewrites B's create and leaves A's source, entry_id and action_id", async () => {
    await seedHeldPair()
    const [created] = await deltasOn(B, 'act_pass')
    const aCreate = await deltaOn(A, created.id)
    expect(aCreate).toMatchObject({ source: 'periodic_classifier', actionId: 'act_pass' })

    await reverseOn(B, [created])

    expect(await deltaOn(B, created.id)).toMatchObject({
      source: 'user_edit',
      entryId: null,
      actionId: 'act_user',
    })
    expect(await deltaOn(A, created.id)).toEqual(aCreate)
  })

  it("a held delete's payload rewrite on B leaves A's payload", async () => {
    await seedHeldPair()
    const [created] = await deltasOn(B, 'act_pass')
    const [holder] = await deltasOn(B, 'act_del')
    const aHolder = await deltaOn(A, holder.id)

    await reverseOn(B, [created])

    expect((await deltaOn(B, holder.id))?.undoPayload).not.toEqual(holder.undoPayload)
    expect(aHolder?.undoPayload).toEqual(holder.undoPayload)
    expect(await deltaOn(A, holder.id)).toEqual(aHolder)
  })

  it("a survivor rewrite on B leaves A's payload", async () => {
    await openOnA()
    await onA('act_0', {
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: character('char_kael', { state: STATE }) },
    })
    const withVoice = (voice: string) => ({ state: { ...STATE, voice } })
    await onA('act_close', {
      kind: 'updateEntity',
      source: 'chapter_close',
      payload: { branchId: A, id: 'char_kael', patch: withVoice('hoarse') },
    })
    await onA('act_pass', {
      kind: 'updateEntity',
      source: 'periodic_classifier',
      payload: { branchId: A, id: 'char_kael', patch: withVoice('steady') },
    })
    cloneBranch(t.sqlite, A, B)
    const [survivor] = await deltasOn(B, 'act_pass')
    const aSurvivor = await deltaOn(A, survivor.id)
    const rewritten = { state: { voice: 'low and dry' } }
    expect(survivor.undoPayload).not.toEqual(rewritten)

    await reverseOn(B, await deltasOn(B, 'act_close'))

    expect((await deltaOn(B, survivor.id))?.undoPayload).toEqual(rewritten)
    expect(await deltaOn(A, survivor.id)).toEqual(aSurvivor)
  })

  it("rollbackToEntry on B leaves A's rows and log", async () => {
    await openOnA()
    await ctx.db
      .insert(storyEntries)
      .values({ id: 'op', branchId: A, position: 1, kind: 'opening', content: 'o', createdAt: 1 })
    const reply = (id: string, position: number): PipelineAction => ({
      kind: 'createStoryEntry',
      source: 'ai_classifier',
      payload: {
        entry: {
          id,
          branchId: A,
          position,
          kind: 'ai_reply',
          content: id,
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: position },
          createdAt: 1,
        },
      },
    })
    await onA('turn1', reply('t1', 2))
    await onA('turn2', reply('t2', 3))
    await onA('turn2', {
      kind: 'createEntity',
      source: 'ai_classifier',
      payload: { entry: character('ent_a', { name: 'Aria' }) },
    })
    await onA('turn3', reply('t3', 4))
    await onA('turn3', {
      kind: 'updateEntity',
      source: 'ai_classifier',
      payload: { branchId: A, id: 'ent_a', patch: { name: 'Aria the Bold' } },
    })
    cloneBranch(t.sqlite, A, B)
    const aBefore = branchSnapshot(t.sqlite, A)
    const counts = await shownCounts(B, 't2', ctx)

    expect(await rollbackToEntry(B, 't2', ctx, { expectedCounts: counts })).toMatchObject({
      status: 'ok',
    })

    const onB = await ctx.db
      .select({ id: storyEntries.id })
      .from(storyEntries)
      .where(eq(storyEntries.branchId, B))
    expect(onB.map((row) => row.id).sort()).toEqual(['op', 't1'])
    expect(await deltasOn(A, 'turn2', 'turn3')).toHaveLength(4)
    expect(branchSnapshot(t.sqlite, A)).toEqual(aBefore)
  })
})

describe('redo and the re-run write-back on a copied branch', () => {
  it("redoLastAction on B restores B's survivor payload and leaves A's", async () => {
    await openOnA()
    await onA('act_0', {
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: character('char_kael', { name: 'Kael', keywords: ['the knight'] }) },
    })
    await onA('act_u', {
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId: A, id: 'char_kael', patch: { keywords: ['the knight', 'ser kael'] } },
    })
    await onA('act_pass', {
      kind: 'appendEntityKeywords',
      source: 'periodic_classifier',
      payload: { branchId: A, id: 'char_kael', keywords: ['the wanderer'], proseEntryId: null },
    })
    cloneBranch(t.sqlite, A, B)
    const [survivor] = await deltasOn(B, 'act_pass')
    const undone = { keywords: ['the knight'] }
    expect(survivor.undoPayload).not.toEqual(undone)
    // A's copy differs from B's, so a restore that reached A would show.
    await ctx.db
      .update(deltas)
      .set({ undoPayload: { keywords: ['changed on A'] } })
      .where(and(eq(deltas.branchId, A), eq(deltas.id, survivor.id)))
    const aBefore = branchSnapshot(t.sqlite, A)
    entriesStore.hydrate(B, [])

    expect(await undoLastAction(B, ctx)).toEqual({ status: 'ok' })
    expect((await deltaOn(B, survivor.id))?.undoPayload).toEqual(undone)
    expect(await redoLastAction(B, ctx)).toEqual({ status: 'ok' })

    expect((await deltaOn(B, survivor.id))?.undoPayload).toEqual(survivor.undoPayload)
    expect(branchSnapshot(t.sqlite, A)).toEqual(aBefore)
  })

  it('undoLastAction of a re-run on B writes its journal back onto B and leaves A', async () => {
    const fx = await seedCopyFixture(t)
    const [stored] = await ctx.db
      .select()
      .from(reversalJournals)
      .where(
        and(
          eq(reversalJournals.branchId, fx.branchId),
          eq(reversalJournals.actionId, fx.journalActionId),
        ),
      )
    const journal = parseRerunJournal(stored.journal)
    const restoredRows = journal.rows.filter((row) => row.before !== null)
    expect(journal.deltas).not.toEqual([])
    expect(restoredRows).not.toEqual([])
    cloneBranch(t.sqlite, fx.branchId, B)
    const aBefore = branchSnapshot(t.sqlite, fx.branchId)
    entriesStore.hydrate(B, [])

    expect(await undoLastAction(B, ctx)).toEqual({ status: 'ok' })

    expect(await deltasOn(B, fx.journalActionId)).toEqual([])
    expect(
      await ctx.db.select().from(reversalJournals).where(eq(reversalJournals.branchId, B)),
    ).toEqual([])
    for (const logged of journal.deltas)
      expect(await deltaOn(B, logged.id)).toEqual({ ...logged, branchId: B })
    for (const { table, id } of restoredRows)
      expect(await readCurrentRow(ctx, table, { branchId: B, targetId: id })).toMatchObject({
        id,
        branchId: B,
      })
    expect(branchSnapshot(t.sqlite, fx.branchId)).toEqual(aBefore)
  })
})
