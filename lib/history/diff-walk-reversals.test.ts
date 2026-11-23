import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DeltaSource, PipelineAction } from '@/lib/actions'
import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { __resetBranchWriteLocks } from '@/lib/actions/delta/branch-write-lock'
import { reverseAndPruneDeltaRows, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { selectReversalSet } from '@/lib/actions/delta/row-closure'
import { redoLastAction, undoLastAction } from '@/lib/actions/story-entries/undo'
import {
  branches,
  deltas,
  stories,
  type DbCtx,
  type Delta,
  type NewEntity,
  type NewLore,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { cloneBranch, type TestDb } from '@/lib/db/__tests__/two-branch'
import { entitiesStore, entriesStore, resetAllStores, undoRedoStore } from '@/lib/stores'

import { walkTarget, type UpdateDelta } from './diff-walk'

// generation-pipeline.md → Reverse-replay: a reversal rewrites a survivor's prior value and a redo
// puts it back; data-model.md → Branch model: a copy repeats every delta id on the new branch.

let t: TestDb
let ctx: DbCtx

beforeEach(async () => {
  resetAllStores()
  undoRedoStore.clear('b1')
  t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await t.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await t.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'main', createdAt: 1 })
})

afterEach(() => {
  __resetBranchWriteLocks()
  resetAllStores()
  undoRedoStore.clear('b1')
})

async function act(actionId: string, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

async function deltasOn(branchId: string, actionId: string): Promise<Delta[]> {
  return (await t.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, branchId), eq(deltas.actionId, actionId)))
    .orderBy(asc(deltas.logPosition))) as Delta[]
}

async function onlyOn(branchId: string, actionId: string): Promise<UpdateDelta> {
  const rows = await deltasOn(branchId, actionId)
  if (rows.length !== 1) throw new Error(`${actionId} on ${branchId}: ${rows.length} deltas`)
  const [delta] = rows
  if (delta.op !== 'update') throw new Error(`${actionId} on ${branchId}: a ${delta.op}`)
  return { ...delta, op: delta.op }
}

const FORD: NewLore = {
  id: 'lore_ford',
  branchId: 'b1',
  title: 'The ford',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
}

const editFord = (
  source: DeltaSource,
  patch: { title?: string; body?: string | null },
): PipelineAction => ({
  kind: 'updateLore',
  source,
  payload: { branchId: 'b1', id: 'lore_ford', patch, proseEntryId: null },
})

const KAEL: NewEntity = {
  id: 'char_kael',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  status: 'active',
  injectionMode: 'auto',
  keywords: ['the knight'],
  createdAt: 1,
  updatedAt: 1,
}

/** A user's keyword edit, then a pass's append that the edit's undo leaves standing. */
async function seedSurvivor(): Promise<void> {
  await act('act_0', { kind: 'createEntity', source: 'user_edit', payload: { entry: KAEL } })
  await act('act_u', {
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: 'b1', id: 'char_kael', patch: { keywords: ['the knight', 'ser kael'] } },
  })
  await act('act_pass', {
    kind: 'appendEntityKeywords',
    source: 'periodic_classifier',
    payload: { branchId: 'b1', id: 'char_kael', keywords: ['the wanderer'], proseEntryId: null },
  })
}

const ORIGINAL = {
  old: { keywords: ['the knight', 'ser kael'] },
  new: { keywords: ['the knight', 'ser kael', 'the wanderer'] },
  names: {},
}

const REWRITTEN = {
  old: { keywords: ['the knight'] },
  new: { keywords: ['the knight', 'the wanderer'] },
  names: {},
}

describe('walkTarget across reversals', () => {
  it("resolves a pass's update an abort reversed after its row loaded as gone", async () => {
    await act('act_0', { kind: 'createLore', source: 'user_edit', payload: { entry: FORD } })
    await act('act_user', editFord('user_edit', { body: 'Shallow in summer.' }))
    await act('act_pass', editFord('periodic_classifier', { title: 'The Harrow ford' }))
    const user = await onlyOn('b1', 'act_user')
    const pass = await onlyOn('b1', 'act_pass')

    expect(await reverseReplayDeltas('act_pass', ctx)).toBe(1)

    const alone = await walkTarget(t.db, [pass])
    expect(alone.entries.size).toBe(0)
    expect([...alone.gone]).toEqual([pass.id])

    const beside = await walkTarget(t.db, [user, pass])
    expect([...beside.gone]).toEqual([pass.id])
    expect([...beside.entries.keys()]).toEqual([user.id])
    expect(beside.entries.get(user.id)).toEqual({
      old: { body: null },
      new: { body: 'Shallow in summer.' },
      names: {},
    })
  })

  it('gives a survivor its rewritten old after CTRL-Z of the edit, and its original after the redo', async () => {
    entitiesStore.hydrate('b1', [])
    entriesStore.hydrate('b1', [])
    await seedSurvivor()
    const survivor = await onlyOn('b1', 'act_pass')
    expect((await walkTarget(t.db, [survivor])).entries.get(survivor.id)).toEqual(ORIGINAL)

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect((await onlyOn('b1', 'act_pass')).undoPayload).toEqual({ keywords: ['the knight'] })
    const undone = await walkTarget(t.db, [survivor])
    expect(undone.gone.size).toBe(0)
    expect(undone.entries.get(survivor.id)).toEqual(REWRITTEN)

    expect(await redoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect((await walkTarget(t.db, [survivor])).entries.get(survivor.id)).toEqual(ORIGINAL)
  })

  it('gives one delta id on two branches the entry of its own branch', async () => {
    await seedSurvivor()
    cloneBranch(t.sqlite, 'b1', 'b2')
    await reverseAndPruneDeltaRows(
      await selectReversalSet(ctx, { branchId: 'b2', target: await deltasOn('b2', 'act_u') }),
      ctx,
      { keepRedoExact: false },
    )
    const onB1 = await onlyOn('b1', 'act_pass')
    const onB2 = await onlyOn('b2', 'act_pass')
    expect(onB2.id).toBe(onB1.id)
    expect(onB2.undoPayload).toEqual({ keywords: ['the knight'] })

    expect((await walkTarget(t.db, [onB1])).entries.get(onB1.id)).toEqual(ORIGINAL)
    expect((await walkTarget(t.db, [onB2])).entries.get(onB2.id)).toEqual(REWRITTEN)
  })
})
