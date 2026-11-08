import { describe, expect, it } from 'vitest'

import { branches, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { generateId } from '@/lib/ids'

import type { DbCtx, DeltaSource, GuardRow } from '../types'
import { deltaRowOp } from './delta-row'
import { laterTurnDeltas } from './later-turn'
import type { DeltaOp } from './registry'

const BRANCH = 'br_1'

type Logged = {
  branchId?: string
  actionId: string
  table: string
  id: string
  entryId?: string | null
  source?: DeltaSource
  op?: DeltaOp
  undoPayload?: Record<string, unknown> | null
}

/** One delta, logged as the action layer logs it, with the next log position. */
async function log(ctx: DbCtx, delta: Logged): Promise<string> {
  const deltaId = generateId('delta')
  await ctx.runInTransaction([
    deltaRowOp(ctx, {
      deltaId,
      branchId: delta.branchId ?? BRANCH,
      entryId: delta.entryId ?? null,
      actionId: delta.actionId,
      source: delta.source ?? 'per_turn_classifier',
      target: {
        targetTable: delta.table,
        targetId: delta.id,
        op: delta.op ?? 'update',
        undoPayload: delta.undoPayload === undefined ? { description: null } : delta.undoPayload,
      },
    }),
  ])
  return deltaId
}

/** An entry at `position`; its `story_entries` create runs under `actionId`, or none (a raw insert). */
async function entry(
  ctx: DbCtx,
  id: string,
  position: number,
  actionId: string | null,
  branchId = BRANCH,
) {
  await ctx.db
    .insert(storyEntries)
    .values({ id, branchId, position, kind: 'ai_reply', content: 'prose', createdAt: 1 })
  if (actionId !== null)
    await log(ctx, {
      branchId,
      actionId,
      table: 'story_entries',
      id,
      op: 'create',
      undoPayload: null,
    })
}

/** e_1 and e_2 are the chapter (E = e_2); e_3 and e_4 are later turns, e_5 a raw insert past E. */
async function setup(): Promise<DbCtx> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 'story_1', name: 'main', createdAt: 1 })
  const ctx: DbCtx = { db, runInTransaction }
  await entry(ctx, 'e_1', 1, 'act_t1')
  await entry(ctx, 'e_2', 2, 'act_t2')
  await entry(ctx, 'e_3', 3, 'act_t3')
  await entry(ctx, 'e_4', 4, 'act_t4')
  await entry(ctx, 'e_5', 5, null)
  return ctx
}

const CHAR: GuardRow = { table: 'entities', id: 'char_1' }

const laterIds = async (ctx: DbCtx, rows: readonly GuardRow[] = [CHAR]) =>
  (await laterTurnDeltas(ctx, BRANCH, 'e_2', rows)).map((d) => d.id)

describe('laterTurnDeltas (C12)', () => {
  it('counts a delta anchored on an entry past E', async () => {
    const ctx = await setup()
    const anchored = await log(ctx, {
      actionId: 'act_pass',
      source: 'periodic_classifier',
      table: 'entities',
      id: 'char_1',
      entryId: 'e_3',
    })
    expect(await laterIds(ctx)).toEqual([anchored])
  })

  it("counts a null-anchored delta in a later turn's action", async () => {
    const ctx = await setup()
    const folded = await log(ctx, { actionId: 'act_t4', table: 'entities', id: 'char_1' })
    expect(await laterIds(ctx)).toEqual([folded])
  })

  it("doesn't count a null-anchored delta in the chapter's own turn or in no turn", async () => {
    const ctx = await setup()
    await log(ctx, { actionId: 'act_t2', table: 'entities', id: 'char_1' })
    await log(ctx, { actionId: 'act_user', source: 'user_edit', table: 'entities', id: 'char_1' })
    expect(await laterIds(ctx)).toEqual([])
  })

  it("takes a turn's action from its entry's create alone, not a later write to the entry", async () => {
    const ctx = await setup()
    await log(ctx, {
      actionId: 'act_pass',
      source: 'periodic_classifier',
      table: 'story_entries',
      id: 'e_3',
      entryId: 'e_3',
      undoPayload: { metadata: null },
    })
    await log(ctx, {
      actionId: 'act_pass',
      source: 'periodic_classifier',
      table: 'entities',
      id: 'char_1',
    })
    expect(await laterIds(ctx)).toEqual([])
  })

  it("doesn't count a pass anchored inside the chapter, though it landed after the later turns", async () => {
    const ctx = await setup()
    await log(ctx, {
      actionId: 'act_pass',
      source: 'periodic_classifier',
      table: 'entities',
      id: 'char_1',
      entryId: 'e_1',
    })
    expect(await laterIds(ctx)).toEqual([])
  })

  it("doesn't count a chapter_close delta, even anchored past E", async () => {
    const ctx = await setup()
    await log(ctx, {
      actionId: 'act_close',
      source: 'chapter_close',
      table: 'entities',
      id: 'char_1',
      entryId: 'e_4',
    })
    expect(await laterIds(ctx)).toEqual([])
  })

  it("doesn't count a retrievalCount-only update, but does one that also writes a field", async () => {
    const ctx = await setup()
    const bump = { table: 'happening_awareness', entryId: 'e_3', actionId: 'act_t3' } as const
    await log(ctx, { ...bump, id: 'haw_1', undoPayload: { retrievalCount: 2 } })
    const written = await log(ctx, {
      ...bump,
      id: 'haw_2',
      undoPayload: { retrievalCount: 2, source: 'witnessed' },
    })
    const rows: GuardRow[] = [
      { table: 'happening_awareness', id: 'haw_1' },
      { table: 'happening_awareness', id: 'haw_2' },
    ]
    expect(await laterIds(ctx, rows)).toEqual([written])
  })

  it('reads an entry with no create delta as naming no action, though its anchor counts', async () => {
    const ctx = await setup()
    await log(ctx, { actionId: 'act_raw', table: 'entities', id: 'char_1' })
    const anchored = await log(ctx, {
      actionId: 'act_pass',
      source: 'periodic_classifier',
      table: 'entities',
      id: 'char_1',
      entryId: 'e_5',
    })
    expect(await laterIds(ctx)).toEqual([anchored])
  })

  it("returns a later turn's create of the row", async () => {
    const ctx = await setup()
    const created = await log(ctx, {
      actionId: 'act_t3',
      table: 'entities',
      id: 'char_new',
      op: 'create',
      undoPayload: null,
    })
    expect(await laterIds(ctx, [{ table: 'entities', id: 'char_new' }])).toEqual([created])
  })

  it('reads lore rows, and only the rows it is given, oldest first', async () => {
    const ctx = await setup()
    const char = await log(ctx, { actionId: 'act_t4', table: 'entities', id: 'char_1' })
    await log(ctx, { actionId: 'act_t3', table: 'entities', id: 'char_2' })
    const lore = await log(ctx, { actionId: 'act_t3', table: 'lore', id: 'lore_1' })
    expect(await laterIds(ctx, [{ table: 'lore', id: 'lore_1' }, CHAR])).toEqual([char, lore])
  })

  it("reads only the branch's own deltas and turns, though a fork shares its ids", async () => {
    const ctx = await setup()
    await ctx.db
      .insert(branches)
      .values({ id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 1 })
    await entry(ctx, 'e_3', 3, 'act_fork_t3', 'br_2')
    await log(ctx, {
      branchId: 'br_2',
      actionId: 'act_fork_pass',
      source: 'periodic_classifier',
      table: 'entities',
      id: 'char_1',
      entryId: 'e_3',
    })
    await log(ctx, { actionId: 'act_fork_t3', table: 'entities', id: 'char_1' })
    expect(await laterIds(ctx)).toEqual([])
  })

  it('throws when E is not an entry of the branch', async () => {
    const ctx = await setup()
    await expect(laterTurnDeltas(ctx, BRANCH, 'e_missing', [CHAR])).rejects.toThrow(
      'end entry br_1:e_missing not found',
    )
  })
})
