import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { Delta, HappeningAwareness } from '@/lib/db'
import { branches, deltas, happeningAwareness, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { happeningAwarenessStore } from '@/lib/stores'

import { registerHappeningAwareness } from './register-awareness'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'

const BRANCH = 'br_1'
const OTHER_BRANCH = 'br_2'

async function setup(rows: HappeningAwareness[] = []) {
  __resetRegistry()
  registerHappeningAwareness()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: BRANCH, storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: OTHER_BRANCH, storyId: 'story_1', name: 'fork', createdAt: 1 },
  ])
  if (rows.length > 0) await db.insert(happeningAwareness).values(rows)
  happeningAwarenessStore.__reset()
  happeningAwarenessStore.hydrate(
    BRANCH,
    rows.filter((r) => r.branchId === BRANCH),
  )
  return { db, ctx: { db, runInTransaction } }
}

async function awarenessRows(
  db: Awaited<ReturnType<typeof setup>>['db'],
  characterId: string,
  happeningId: string,
) {
  return db
    .select()
    .from(happeningAwareness)
    .where(
      and(
        eq(happeningAwareness.characterId, characterId),
        eq(happeningAwareness.happeningId, happeningId),
      ),
    )
}

describe('happening_awareness upsert', () => {
  it('first emit creates a row + delta + store patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'ai_classifier',
          payload: {
            branchId: 'br_1',
            characterId: 'char_a',
            happeningId: 'hap_1',
            learnedAtEntryId: 'entry_3',
            decayResistance: 0.2,
            source: 'overheard in tavern',
          },
        },
        actionId: 'act_1',
        branchId: 'br_1',
      },
      ctx,
    )
    const rows = await awarenessRows(db, 'char_a', 'hap_1')
    expect(rows.length).toBe(1)
    expect(rows[0].source).toBe('overheard in tavern')
    expect(rows[0].retrievalCount).toBe(0)
    expect(happeningAwarenessStore.getByCharacter('char_a').length).toBe(1)
  })

  it('re-emit merges into one row: overwrites source+decay, preserves learned_at + retrieval_count', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'ai_classifier',
          payload: {
            branchId: 'br_1',
            characterId: 'char_a',
            happeningId: 'hap_1',
            learnedAtEntryId: 'entry_3',
            decayResistance: 0.2,
            source: 'overheard',
          },
        },
        actionId: 'act_1',
        branchId: 'br_1',
      },
      ctx,
    )
    const [created] = await awarenessRows(db, 'char_a', 'hap_1')
    await ctx.runInTransaction([
      ctx.db
        .update(happeningAwareness)
        .set({ retrievalCount: 7 })
        .where(eq(happeningAwareness.id, created.id))
        .toSQL(),
    ])

    await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'ai_classifier',
          payload: {
            branchId: 'br_1',
            characterId: 'char_a',
            happeningId: 'hap_1',
            learnedAtEntryId: 'entry_9',
            decayResistance: 0.8,
            source: 'told by Jorin',
          },
        },
        actionId: 'act_2',
        branchId: 'br_1',
      },
      ctx,
    )
    const rows = await awarenessRows(db, 'char_a', 'hap_1')
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe(created.id)
    expect(rows[0].source).toBe('told by Jorin')
    expect(rows[0].decayResistance).toBe(0.8)
    expect(rows[0].learnedAtEntryId).toBe('entry_3')
    expect(rows[0].retrievalCount).toBe(7)

    expect(await reverseReplayDeltas('act_2', ctx)).toBe(1)
    const back = await awarenessRows(db, 'char_a', 'hap_1')
    expect(back[0].source).toBe('overheard')
    expect(back[0].decayResistance).toBe(0.2)
    expect(back[0].retrievalCount).toBe(7)
  })

  it('the DB UNIQUE backstops a duplicate natural key', async () => {
    const { ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', characterId: 'char_a', happeningId: 'hap_1', source: 's' },
        },
        actionId: 'act_1',
        branchId: 'br_1',
      },
      ctx,
    )
    await expect(
      ctx.runInTransaction([
        ctx.db
          .insert(happeningAwareness)
          .values({
            id: 'haw_dup',
            branchId: 'br_1',
            characterId: 'char_a',
            happeningId: 'hap_1',
            retrievalCount: 0,
          })
          .toSQL(),
      ]),
    ).rejects.toThrow()
  })

  it('delete; reverse-replay re-inserts with original id', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', characterId: 'char_a', happeningId: 'hap_1', source: 's' },
        },
        actionId: 'act_1',
        branchId: 'br_1',
      },
      ctx,
    )
    const [created] = await awarenessRows(db, 'char_a', 'hap_1')
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteHappeningAwareness',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: created.id },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await awarenessRows(db, 'char_a', 'hap_1')).length).toBe(0)
    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    const back = await awarenessRows(db, 'char_a', 'hap_1')
    expect(back[0].id).toBe(created.id)
    expect(happeningAwarenessStore.getById(created.id)?.source).toBe('s')
  })

  it('reverse-replay of the create deletes the row + prunes the store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', characterId: 'char_a', happeningId: 'hap_1', source: 's' },
        },
        actionId: 'act_1',
        branchId: 'br_1',
      },
      ctx,
    )
    const [created] = await awarenessRows(db, 'char_a', 'hap_1')
    expect(happeningAwarenessStore.getById(created.id)?.source).toBe('s')
    expect(await reverseReplayDeltas('act_1', ctx)).toBe(1)
    expect((await awarenessRows(db, 'char_a', 'hap_1')).length).toBe(0)
    expect(happeningAwarenessStore.getById(created.id)).toBeUndefined()
  })

  it('collapses an empty learned-at ref to NULL on create', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            characterId: 'char_a',
            happeningId: 'hap_1',
            learnedAtEntryId: '',
            source: 's',
          },
        },
        actionId: 'act_1',
        branchId: 'br_1',
      },
      ctx,
    )
    const rows = await awarenessRows(db, 'char_a', 'hap_1')
    expect(rows[0].learnedAtEntryId).toBeNull()
  })

  it('create is allowed with no authored fields (awareness-only record)', async () => {
    const { db, ctx } = await setup()
    const res = await applyDeltaAction(
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', characterId: 'char_a', happeningId: 'hap_1' },
        },
        actionId: 'act_1',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(res.status).toBe('ok')
    const rows = await awarenessRows(db, 'char_a', 'hap_1')
    expect(rows.length).toBe(1)
    expect(rows[0].source).toBeNull()
  })
})

function awarenessRow(
  id: string,
  retrievalCount: number,
  opts: { branchId?: string } = {},
): HappeningAwareness {
  return {
    id,
    branchId: opts.branchId ?? BRANCH,
    happeningId: `hap_${id}`,
    characterId: `char_${id}`,
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount,
    source: null,
  }
}

type Ctx = Awaited<ReturnType<typeof setup>>['ctx']

function bump(id: string, opts: { payloadBranchId?: string; actionId?: string } = {}) {
  return {
    action: {
      kind: 'bumpAwarenessRetrieval' as const,
      source: 'ai_classifier' as const,
      payload: { branchId: opts.payloadBranchId ?? BRANCH, id },
    },
    actionId: opts.actionId ?? 'act_1',
    branchId: BRANCH,
  }
}

async function countOf(ctx: Ctx, id: string, branchId = BRANCH): Promise<number | undefined> {
  const rows = await ctx.db.select().from(happeningAwareness).where(eq(happeningAwareness.id, id))
  return rows.find((r) => r.branchId === branchId)?.retrievalCount
}

async function deltaRows(ctx: Ctx): Promise<Delta[]> {
  return (await ctx.db.select().from(deltas).orderBy(asc(deltas.logPosition))) as Delta[]
}

describe('bumpAwarenessRetrieval', () => {
  it('increments the counter by one and mirrors it into the working-set store', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 4)])

    const result = await applyDeltaAction(bump('haw_1'), ctx)

    expect(result.status).toBe('ok')
    expect(await countOf(ctx, 'haw_1')).toBe(5)
    expect(happeningAwarenessStore.getById('haw_1')?.retrievalCount).toBe(5)
  })

  // Second arm so neither the read nor the increment can be a constant that
  // happens to fit the case above.
  it('starts a never-retrieved row at one', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 0)])

    await applyDeltaAction(bump('haw_1'), ctx)

    expect(await countOf(ctx, 'haw_1')).toBe(1)
  })

  it('logs one update delta whose undo payload is the PRIOR value, not the increment', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 4)])

    await applyDeltaAction(bump('haw_1'), ctx)

    const rows = await deltaRows(ctx)
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({
      targetTable: 'happening_awareness',
      targetId: 'haw_1',
      op: 'update',
      actionId: 'act_1',
      undoPayload: { retrievalCount: 4 },
    })
  })

  it('reverse-replay of the turn restores the pre-turn count', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 4)])
    await applyDeltaAction(bump('haw_1'), ctx)

    expect(await reverseReplayDeltas('act_1', ctx)).toBe(1)

    expect(await countOf(ctx, 'haw_1')).toBe(4)
    expect(happeningAwarenessStore.getById('haw_1')?.retrievalCount).toBe(4)
  })

  // Distinct from the single-bump reverse above: two deltas land under one
  // action_id, each carrying the value it replaced, and reverse-replay walks
  // them newest-first (log_position DESC), so the count goes 6 → 5 → 4. Oldest
  // first would land on 5, since the older delta's replaced value is applied
  // before the newer one overwrites it.
  it('reverses two bumps of the same row in one reversal window back to the original count', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 4)])
    await applyDeltaAction(bump('haw_1'), ctx)
    await applyDeltaAction(bump('haw_1'), ctx)
    expect(await countOf(ctx, 'haw_1')).toBe(6)

    expect(await reverseReplayDeltas('act_1', ctx)).toBe(2)

    expect(await countOf(ctx, 'haw_1')).toBe(4)
  })

  it('applies to two different rows in one turn without cross-talk', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 0), awarenessRow('haw_2', 5)])

    for (const id of ['haw_1', 'haw_2']) {
      const result = await applyDeltaAction(bump(id), ctx)
      expect(result.status).toBe('ok')
    }

    expect(await countOf(ctx, 'haw_1')).toBe(1)
    expect(await countOf(ctx, 'haw_2')).toBe(6)
  })

  it('rejects a branch mismatch and leaves the counter alone', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 4)])

    const result = await applyDeltaAction(bump('haw_1', { payloadBranchId: 'br_other' }), ctx)

    expect(result).toMatchObject({ status: 'rejected' })
    expect(result.status === 'rejected' && result.reason).toContain('branch mismatch')
    expect(await countOf(ctx, 'haw_1')).toBe(4)
    expect(await deltaRows(ctx)).toEqual([])
  })

  it('rejects a missing target row rather than inserting one', async () => {
    const { ctx } = await setup([awarenessRow('haw_present', 3)])

    const result = await applyDeltaAction(bump('haw_missing'), ctx)

    expect(result).toMatchObject({ status: 'rejected' })
    expect(result.status === 'rejected' && result.reason).toContain('not found')
    expect(await ctx.db.select().from(happeningAwareness)).toHaveLength(1)
    // Positive control: the same db, the same call shape, an id that IS there.
    expect((await applyDeltaAction(bump('haw_present'), ctx)).status).toBe('ok')
  })

  // The payload guard only compares the two branch ids; nothing there stops the
  // row LOOKUP from matching a same-id row on a sibling branch, which the
  // composite (branch_id, id) PK makes legal. Sole row in the table, so no scan
  // order can hide an unscoped lookup.
  it('does not find a same-id row that lives on a sibling branch', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 9, { branchId: OTHER_BRANCH })])

    const result = await applyDeltaAction(bump('haw_1'), ctx)

    expect(result).toMatchObject({ status: 'rejected' })
    // The reason, not just the status: a handler missing from the registry also
    // rejects, and that would read as this guard firing.
    expect(result.status === 'rejected' && result.reason).toContain('not found')
    expect(await countOf(ctx, 'haw_1', OTHER_BRANCH)).toBe(9)
    expect(await deltaRows(ctx)).toEqual([])
  })

  // The write side of the same seam. `next` is computed in JS, not as
  // `retrieval_count = retrieval_count + 1`, so an unscoped UPDATE would ASSIGN
  // the run branch's value to the sibling row — moving it 9 → 5, not 9 → 10.
  it('bumps only the run branch when both branches carry the id', async () => {
    const { ctx } = await setup([
      awarenessRow('haw_1', 9, { branchId: OTHER_BRANCH }),
      awarenessRow('haw_1', 4),
    ])

    await applyDeltaAction(bump('haw_1'), ctx)

    expect(await countOf(ctx, 'haw_1')).toBe(5)
    expect(await countOf(ctx, 'haw_1', OTHER_BRANCH)).toBe(9)
  })
})
