import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

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

// priorCount is explicit because the handler no longer reads it — the retrieval
// pass supplies the value it saw, so a caller passing a stale one is the failure
// mode these tests have to be able to express.
function bump(
  id: string,
  priorCount: number,
  opts: { payloadBranchId?: string; actionId?: string } = {},
) {
  return {
    action: {
      kind: 'bumpAwarenessRetrieval' as const,
      source: 'ai_classifier' as const,
      payload: { branchId: opts.payloadBranchId ?? BRANCH, id, priorCount },
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

    const result = await applyDeltaAction(bump('haw_1', 4), ctx)

    expect(result.status).toBe('ok')
    expect(await countOf(ctx, 'haw_1')).toBe(5)
    expect(happeningAwarenessStore.getById('haw_1')?.retrievalCount).toBe(5)
  })

  // The periodic classifier and a turn do not block each other, so a classifier
  // run that aborts after retrieval snapshotted its awareness rows reverse-
  // replays them away mid-turn. The handler no longer reads the row, so it can
  // no longer see this and reject as 'noop': it logs a delta whose UPDATE
  // matches nothing. What still has to hold is that the turn survives and the
  // table is untouched — failing here would reverse the user's whole turn over
  // a counter.
  it('survives a vanished bump target without touching the table', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 4)])

    const result = await applyDeltaAction(bump('haw_gone', 4), ctx)

    expect(result.status).toBe('ok')
    // No row created, and the surviving row is untouched.
    expect(await ctx.db.select().from(happeningAwareness)).toHaveLength(1)
    expect(await countOf(ctx, 'haw_1')).toBe(4)
    // The delta is logged against a row that is gone; undo has to no-op on it
    // rather than resurrect it or throw.
    expect(await deltaRows(ctx)).toHaveLength(1)
    expect(await reverseReplayDeltas('act_1', ctx)).toBe(1)
    expect(await ctx.db.select().from(happeningAwareness)).toHaveLength(1)
  })

  // Second arm so the increment cannot be a constant that happens to fit the
  // case above.
  it('starts a never-retrieved row at one', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 0)])

    await applyDeltaAction(bump('haw_1', 0), ctx)

    expect(await countOf(ctx, 'haw_1')).toBe(1)
  })

  // The reason the payload carries priorCount at all. One bump fires per aware
  // in-scene character per seated happening, all ahead of the narrative stream,
  // and the cost lands hardest on slow devices that are not on hand to measure.
  // Reads must therefore not scale with the bump count — a per-bump SELECT
  // creeping back in is invisible to every other assertion here.
  it('reads nothing per bump, so the cost does not scale with scene size', async () => {
    const { ctx } = await setup([
      awarenessRow('haw_1', 0),
      awarenessRow('haw_2', 0),
      awarenessRow('haw_3', 0),
    ])
    const select = vi.spyOn(ctx.db, 'select')

    await applyDeltaAction(bump('haw_1', 0), ctx)
    const afterOne = select.mock.calls.length
    await applyDeltaAction(bump('haw_2', 0), ctx)
    await applyDeltaAction(bump('haw_3', 0), ctx)

    // Pinned as a constant, not a ratio: a ratio stays linear whether or not the
    // handler reads, so it would pass with the SELECT back in. This one read is
    // applyDeltaAction's own bookkeeping; the handler adds none, and re-adding
    // one doubles both numbers.
    const READS_PER_BUMP = 1
    expect(afterOne).toBe(READS_PER_BUMP)
    expect(select.mock.calls.length).toBe(READS_PER_BUMP * 3)
    expect(await countOf(ctx, 'haw_3')).toBe(1)
  })

  // The prior count now arrives from the caller, so a stale one writes a wrong
  // count that no later pass can distinguish from a real one. Nothing in
  // production produces this today — injectedAwareness is duplicate-free and
  // read in the same pass — but it is the cost of dropping the handler's read,
  // and it should fail loudly here if anyone ever reuses a payload.
  it('writes the caller-supplied prior plus one, even when it is stale', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 9)])

    await applyDeltaAction(bump('haw_1', 2), ctx)

    expect(await countOf(ctx, 'haw_1')).toBe(3)
  })

  it('logs one update delta whose undo payload is the PRIOR value, not the increment', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 4)])

    await applyDeltaAction(bump('haw_1', 4), ctx)

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
    await applyDeltaAction(bump('haw_1', 4), ctx)

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
    await applyDeltaAction(bump('haw_1', 4), ctx)
    await applyDeltaAction(bump('haw_1', 5), ctx)
    expect(await countOf(ctx, 'haw_1')).toBe(6)

    expect(await reverseReplayDeltas('act_1', ctx)).toBe(2)

    expect(await countOf(ctx, 'haw_1')).toBe(4)
  })

  it('applies to two different rows in one turn without cross-talk', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 0), awarenessRow('haw_2', 5)])

    for (const [id, prior] of [
      ['haw_1', 0],
      ['haw_2', 5],
    ] as const) {
      const result = await applyDeltaAction(bump(id, prior), ctx)
      expect(result.status).toBe('ok')
    }

    expect(await countOf(ctx, 'haw_1')).toBe(1)
    expect(await countOf(ctx, 'haw_2')).toBe(6)
  })

  it('rejects a branch mismatch and leaves the counter alone', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 4)])

    const result = await applyDeltaAction(bump('haw_1', 4, { payloadBranchId: 'br_other' }), ctx)

    expect(result).toMatchObject({ status: 'rejected' })
    expect(result.status === 'rejected' && result.reason).toContain('branch mismatch')
    expect(await countOf(ctx, 'haw_1')).toBe(4)
    expect(await deltaRows(ctx)).toEqual([])
  })

  it('never inserts a row for a missing target', async () => {
    const { ctx } = await setup([awarenessRow('haw_present', 3)])

    // Accepted now that the handler does not read — an UPDATE cannot insert, so
    // the guarantee this test exists for is the table, not the outcome.
    expect((await applyDeltaAction(bump('haw_missing', 0), ctx)).status).toBe('ok')

    expect(await ctx.db.select().from(happeningAwareness)).toHaveLength(1)
    // Positive control: the same db, the same call shape, an id that IS there.
    expect((await applyDeltaAction(bump('haw_present', 3), ctx)).status).toBe('ok')
    expect(await countOf(ctx, 'haw_present')).toBe(4)
  })

  // The payload guard only compares the two branch ids; nothing there stops the
  // WRITE from matching a same-id row on a sibling branch, which the composite
  // (branch_id, id) PK makes legal. Sole row in the table, so no scan order can
  // hide an unscoped UPDATE.
  it('does not touch a same-id row that lives on a sibling branch', async () => {
    const { ctx } = await setup([awarenessRow('haw_1', 9, { branchId: OTHER_BRANCH })])

    await applyDeltaAction(bump('haw_1', 4), ctx)

    // 9, not 5: an unscoped UPDATE would assign the run branch's next value here.
    expect(await countOf(ctx, 'haw_1', OTHER_BRANCH)).toBe(9)
  })

  // The write side of the same seam. `next` is computed in JS, not as
  // `retrieval_count = retrieval_count + 1`, so an unscoped UPDATE would ASSIGN
  // the run branch's value to the sibling row — moving it 9 → 5, not 9 → 10.
  it('bumps only the run branch when both branches carry the id', async () => {
    const { ctx } = await setup([
      awarenessRow('haw_1', 9, { branchId: OTHER_BRANCH }),
      awarenessRow('haw_1', 4),
    ])

    await applyDeltaAction(bump('haw_1', 4), ctx)

    expect(await countOf(ctx, 'haw_1')).toBe(5)
    expect(await countOf(ctx, 'haw_1', OTHER_BRANCH)).toBe(9)
  })
})
