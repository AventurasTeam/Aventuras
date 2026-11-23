import { desc, eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  lore,
  pipelineRuns,
  stories,
  type CharacterState,
  type Delta,
  type NewEntity,
  type NewLore,
  type SqlOp,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  entitiesStore,
  entriesStore,
  generationStore,
  loreStore,
  undoRedoStore,
} from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { readCurrentRow } from './redo'
import {
  buildReverseAndPrunePlan,
  DeltaReplayError,
  reverseAndPruneDeltaRows,
  type ReversePlan,
} from './reverse-replay'
import { selectReversalSet, type ReversalSet } from './row-closure'
import type { DbCtx, PipelineAction } from '../types'

let ctx: DbCtx

const character = (id: string, over: Partial<NewEntity> = {}): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

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

const VAEL: NewLore = {
  id: 'lore_vael',
  branchId: 'b1',
  title: 'Vael',
  body: 'ash',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(async () => {
  generationStore.__reset()
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await ctx.db.insert(entities).values([character('char_x'), character('char_y')])
})

afterEach(() => {
  entitiesStore.__reset()
  entriesStore.__reset()
  loreStore.__reset()
  undoRedoStore.__reset()
  vi.restoreAllMocks()
})

async function act(actionId: string, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (result.status !== 'ok')
    throw new Error(`${action.kind} did not land: ${JSON.stringify(result)}`)
}

async function deltasOf(...actionIds: string[]): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(inArray(deltas.actionId, actionIds))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

const byId = (rows: readonly Delta[]): Delta[] => [...rows].sort((a, b) => a.id.localeCompare(b.id))

async function planFor(target: readonly Delta[]): Promise<ReversePlan> {
  return buildReverseAndPrunePlan(await selectReversalSet(ctx, { branchId: 'b1', target }), ctx, {
    keepRedoExact: false,
  })
}

const passView = (subjectId: string, objectId: string, kind: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'periodic_classifier',
  payload: { branchId: 'b1', subjectId, objectId, kind, proseEntryId: null },
})

const userPair = (
  subjectId: string,
  objectId: string,
  kind: string | null,
  inverseKind: string | null,
): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'user_edit',
  payload: { branchId: 'b1', subjectId, objectId, kind, inverseKind },
})

describe('the plan lists the delta rows it prunes, re-owns and rewrites', () => {
  it('lists a re-owned create apart from the prunes, and the holder whose payload it rewrites', async () => {
    await act('act_user0', {
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: character('char_p') },
    })
    await act('act_pass', passView('char_p', 'char_y', 'rival'))
    await act('act_user', userPair('char_p', 'char_y', 'rival', 'mentor'))
    await act('act_del', {
      kind: 'deleteEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'char_p' },
    })
    const [created] = await deltasOf('act_pass')
    const [holder] = await deltasOf('act_del')

    const plan = await planFor([created])

    // The user's later view keeps the row, so the pass's create is the user's now, not pruned.
    expect(plan.reownedDeltas).toEqual([created])
    expect(plan.prunedDeltas).toEqual([])
    expect(plan.rewrittenHolders).toEqual([holder])
    expect(plan.droppedJournals).toEqual([])
    expect(plan.journalOps).toEqual([])
  })

  it('lists the holder it prunes and the writes it strands as pruned, beside the set', async () => {
    await act('act_user0', userPair('char_x', 'char_y', null, 'mentor'))
    await act('act_pass', passView('char_x', 'char_y', 'rival'))
    await act('act_user1', userPair('char_x', 'char_y', 'rival', null))
    const [rel] = await ctx.db.select().from(characterRelationships)
    await act('act_del', {
      kind: 'deleteCharacterRelationship',
      source: 'user_edit',
      payload: { branchId: 'b1', id: rel.id },
    })
    // The pass's update, the relationship's own delete, and the user's create and update.
    const before = await deltasOf('act_user0', 'act_pass', 'act_user1', 'act_del')
    expect(before).toHaveLength(4)

    const plan = await planFor(await deltasOf('act_pass'))

    expect(byId(plan.prunedDeltas)).toEqual(byId(before))
    expect(plan.reownedDeltas).toEqual([])
    expect(plan.rewrittenHolders).toEqual([])
  })

  it('lists a plain set as pruned beside the survivor whose prior value it rewrites', async () => {
    await act('act_0', {
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: character('char_kael', { state: STATE }) },
    })
    const withVoice = (voice: string) => ({ state: { ...STATE, voice } })
    await act('act_close', {
      kind: 'updateEntity',
      source: 'chapter_close',
      payload: { branchId: 'b1', id: 'char_kael', patch: withVoice('hoarse') },
    })
    await act('act_pass', {
      kind: 'updateEntity',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', id: 'char_kael', patch: withVoice('steady') },
    })
    const closed = await deltasOf('act_close')
    const [survivor] = await deltasOf('act_pass')

    const plan = await planFor(closed)

    expect(plan.prunedDeltas).toEqual(closed)
    expect(plan.reownedDeltas).toEqual([])
    expect(plan.rewrittenHolders).toEqual([])
    expect(plan.survivorRewrites).toEqual([
      { delta: survivor, payload: { state: { voice: 'low and dry' } } },
    ])
  })
})

describe('the commit hooks', () => {
  async function seedVael(): Promise<ReversalSet> {
    await act('act_lore', {
      kind: 'createLore',
      source: 'periodic_classifier',
      payload: { entry: VAEL },
    })
    return selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_lore') })
  }

  const marker = (runId: string): SqlOp =>
    ctx.db
      .insert(pipelineRuns)
      .values({ runId, kind: 'chapter-close', actionId: `act_${runId}`, startedAt: 1 })
      .toSQL()

  async function runIds(): Promise<string[]> {
    const rows = await ctx.db.select({ runId: pipelineRuns.runId }).from(pipelineRuns)
    return rows.map((r) => r.runId).sort()
  }

  const vael = () => ctx.db.select().from(lore).where(eq(lore.id, 'lore_vael'))

  it('leads the transaction with the hook ops and keeps the extra ops last', async () => {
    const set = await seedVael()
    const seen: SqlOp[][] = []
    const spying: DbCtx = {
      db: ctx.db,
      runInTransaction: (ops) => {
        seen.push(ops)
        return ctx.runInTransaction(ops)
      },
    }
    let heard: ReversePlan | undefined
    let given: ReversePlan | undefined
    const hookOp = marker('run_hook')
    const extraOp = marker('run_extra')

    await reverseAndPruneDeltaRows(
      set,
      spying,
      { keepRedoExact: false },
      [extraOp],
      (plan) => {
        heard = plan
      },
      {
        opsFromPlan: async (plan) => {
          given = plan
          return [hookOp]
        },
      },
    )

    expect(given).toBe(heard)
    expect(heard!.ops.length).toBeGreaterThan(0)
    expect(seen).toEqual([
      [hookOp, ...heard!.ops, ...heard!.pruneOps, ...heard!.journalOps, extraOp],
    ])
    expect(await runIds()).toEqual(['run_extra', 'run_hook'])
    expect(await vael()).toEqual([])
  })

  it("emits the extra patches after the plan's, so the store ends as they leave it", async () => {
    const set = await seedVael()
    const [row] = await vael()
    loreStore.hydrate('b1', [row])
    let heard: ReversePlan | undefined

    await reverseAndPruneDeltaRows(
      set,
      ctx,
      { keepRedoExact: false },
      [],
      (plan) => {
        heard = plan
      },
      {
        patchesAfter: [
          { table: 'lore', branchId: 'b1', patch: { op: 'create', id: 'lore_vael', row } },
        ],
      },
    )

    expect(heard!.patches).toEqual([
      { table: 'lore', branchId: 'b1', patch: { op: 'delete', id: 'lore_vael' } },
    ])
    expect(loreStore.getById('b1', 'lore_vael')).toEqual(row)
  })

  it('commits nothing when a hook op fails', async () => {
    const set = await seedVael()
    await ctx.runInTransaction([marker('run_taken')])

    const error = await reverseAndPruneDeltaRows(
      set,
      ctx,
      { keepRedoExact: false },
      [],
      undefined,
      {
        opsFromPlan: async () => [marker('run_taken')],
      },
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DeltaReplayError)
    expect((error as DeltaReplayError).committed).toBe(false)
    expect(await vael()).toHaveLength(1)
    expect(await deltasOf('act_lore')).toHaveLength(1)
  })

  it('rolls the hook op back with the reversal when a later op fails', async () => {
    const set = await seedVael()
    await ctx.runInTransaction([marker('run_taken')])
    const attempted: SqlOp[][] = []
    const spying: DbCtx = {
      db: ctx.db,
      runInTransaction: (ops) => {
        attempted.push(ops)
        return ctx.runInTransaction(ops)
      },
    }
    const hookOp = marker('run_hook')
    const opsFromPlan = vi.fn(async (_plan: ReversePlan) => [hookOp])

    await expect(
      reverseAndPruneDeltaRows(
        set,
        spying,
        { keepRedoExact: false },
        [marker('run_taken')],
        undefined,
        { opsFromPlan },
      ),
    ).rejects.toBeInstanceOf(DeltaReplayError)

    expect(opsFromPlan).toHaveBeenCalledOnce()
    expect(attempted).toHaveLength(1)
    expect(attempted[0][0]).toBe(hookOp)
    expect(await runIds()).toEqual(['run_taken'])
    expect(await vael()).toHaveLength(1)
  })

  it('wraps a hook that throws, committing nothing', async () => {
    const set = await seedVael()

    const error = await reverseAndPruneDeltaRows(
      set,
      ctx,
      { keepRedoExact: false },
      [],
      undefined,
      {
        opsFromPlan: () => Promise.reject(new Error('row read failed')),
      },
    ).catch((e: unknown) => e)

    expect(error).toMatchObject({ name: 'DeltaReplayError', stage: 'transaction' })
    expect(await vael()).toHaveLength(1)
  })

  it('commits a hook op on an empty set, which alone returns without a transaction', async () => {
    const empty = await selectReversalSet(ctx, { branchId: 'b1', target: [] })
    const run = vi.fn(ctx.runInTransaction)
    const spying: DbCtx = { db: ctx.db, runInTransaction: run }

    expect(await reverseAndPruneDeltaRows(empty, spying, { keepRedoExact: false })).toBe(0)
    expect(run).not.toHaveBeenCalled()

    expect(
      await reverseAndPruneDeltaRows(empty, spying, { keepRedoExact: false }, [], undefined, {
        opsFromPlan: async () => [marker('run_hook')],
      }),
    ).toBe(0)
    expect(await runIds()).toEqual(['run_hook'])
  })

  describe('readCurrentRow', () => {
    it('reads a row whole, and null for one absent or on another branch', async () => {
      await seedVael()
      const [row] = await vael()

      expect(await readCurrentRow(ctx, 'lore', { branchId: 'b1', targetId: 'lore_vael' })).toEqual(
        row,
      )
      expect(
        await readCurrentRow(ctx, 'lore', { branchId: 'b1', targetId: 'lore_gone' }),
      ).toBeNull()
      expect(
        await readCurrentRow(ctx, 'lore', { branchId: 'b2', targetId: 'lore_vael' }),
      ).toBeNull()
    })

    it('throws on a table no domain registers', async () => {
      await expect(
        readCurrentRow(ctx, 'no_such_table', { branchId: 'b1', targetId: 'x' }),
      ).rejects.toThrow('readCurrentRow: unknown target_table no_such_table')
    })
  })
})
