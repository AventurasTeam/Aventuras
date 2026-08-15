import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { branches, deltas, happenings, storyEntries, type Delta, type StoryEntry } from '@/lib/db'
import { entriesStore, hydrateAppSettings } from '@/lib/stores'

import { branchEntries, openStory, sseFetch, WORKING_CONFIG } from './__tests__/fixtures'
import { regenerateTurn } from './regenerate-turn'
import { expectRan, makeHarness, resetSingletons } from '../../pipeline/__tests__/harness'

vi.mock('@/lib/retrieval', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { retrievalSuccess } = await import('@/lib/retrieval/__tests__/outcome')
  return { ...actual, runRetrieval: vi.fn(async () => retrievalSuccess()) }
})
vi.mock('../embedder-swap/engine', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, startSwap: vi.fn(async () => 'completed' as const) }
})

const ENTRY = (
  id: string,
  position: number,
  kind: StoryEntry['kind'],
  content: string,
): StoryEntry => ({
  id,
  branchId: 'b1',
  position,
  kind,
  content,
  chapterId: null,
  metadata: null,
  createdAt: position,
})

const DELTA = (
  id: string,
  actionId: string,
  targetTable: string,
  targetId: string,
  entryId: string | null,
  source: Delta['source'],
  logPosition: number,
): Delta => ({
  id,
  branchId: 'b1',
  actionId,
  op: 'create' as const,
  targetTable,
  targetId,
  entryId,
  source,
  undoPayload: null,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
})

// opening(1) u1(2) r1(3) u2(4) r2(5); log: turn deltas 1-4, then a catch-up
// classifier pass at 5-6 whose facts anchor to r1 (survives) and r2 (goes).
async function seedTwoTurnsWithCatchUp(ctx: Awaited<ReturnType<typeof makeHarness>>['ctx']) {
  const rows = [
    ENTRY('e_opening', 1, 'opening', 'once upon a time'),
    ENTRY('e_u1', 2, 'user_action', 'I water the horse.'),
    ENTRY('e_r1', 3, 'ai_reply', 'The horse drinks.'),
    ENTRY('e_u2', 4, 'user_action', 'I cross the bridge.'),
    ENTRY('e_r2', 5, 'ai_reply', 'The bridge groans.'),
  ]
  for (const row of rows) await ctx.db.insert(storyEntries).values(row)
  await ctx.db.insert(happenings).values([
    { id: 'h_a', branchId: 'b1', title: 'Horse watered', createdAt: 6, updatedAt: 6 },
    { id: 'h_b', branchId: 'b1', title: 'Bridge crossed', createdAt: 6, updatedAt: 6 },
  ])
  await ctx.db
    .insert(deltas)
    .values([
      DELTA('d_u1', 'act_t1', 'story_entries', 'e_u1', null, 'user_edit', 1),
      DELTA('d_r1', 'act_t1', 'story_entries', 'e_r1', null, 'ai_classifier', 2),
      DELTA('d_u2', 'act_t2', 'story_entries', 'e_u2', null, 'user_edit', 3),
      DELTA('d_r2', 'act_t2', 'story_entries', 'e_r2', null, 'ai_classifier', 4),
      DELTA('d_fa', 'act_cls', 'happenings', 'h_a', 'e_r1', 'periodic_classifier', 5),
      DELTA('d_fb', 'act_cls', 'happenings', 'h_b', 'e_r2', 'periodic_classifier', 6),
    ])
  await ctx.db
    .update(branches)
    .set({
      classifierStatus: {
        state: 'idle',
        lastSuccessAt: 6,
        lastError: null,
        retryCount: 0,
        processedThrough: 5,
      },
    })
    .where(eq(branches.id, 'b1'))
  entriesStore.hydrate('b1', rows)
}

async function watermark(ctx: Awaited<ReturnType<typeof makeHarness>>['ctx']) {
  const [row] = await ctx.db.select().from(branches).where(eq(branches.id, 'b1'))
  return row.classifierStatus?.processedThrough
}

describe('regenerateTurn', () => {
  beforeEach(() => {
    resetSingletons()
    vi.stubGlobal('fetch', sseFetch(['A new take.']))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetSingletons()
  })

  it('terminal reply: reverses the take + anchored facts, keeps the user action, streams a fresh-action_id reply', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)

    const regen = await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx)

    expect(regen.status).toBe('ran')
    if (regen.status !== 'ran') return
    expect(expectRan(regen.result).outcome).toBe('completed')

    const rows = branchEntries('b1').sort((a, b) => a.position - b.position)
    expect(rows.map((r) => ({ id: r.id, kind: r.kind }))).toEqual([
      { id: 'e_opening', kind: 'opening' },
      { id: 'e_u1', kind: 'user_action' },
      { id: 'e_r1', kind: 'ai_reply' },
      { id: 'e_u2', kind: 'user_action' },
      { id: rows[4].id, kind: 'ai_reply' },
    ])
    expect(rows[4].id).not.toBe('e_r2')
    expect(rows[4].content).toBe('A new take.')
    expect(rows[4].position).toBe(5)

    // Survival anchor: the fact about the surviving turn stays, r2's goes.
    const facts = await ctx.db.select().from(happenings)
    expect(facts.map((f) => f.id)).toEqual(['h_a'])

    // Watermark clamped to position(B) - 1 = position(e_u2).
    expect(await watermark(ctx)).toBe(4)

    // Fresh action_id on the new take; the user action keeps its old group.
    const [newCreate] = await ctx.db
      .select()
      .from(deltas)
      .where(and(eq(deltas.targetId, rows[4].id), eq(deltas.op, 'create')))
    expect(newCreate.actionId).not.toBe('act_t2')
    const [uaCreate] = await ctx.db.select().from(deltas).where(eq(deltas.targetId, 'e_u2'))
    expect(uaCreate.actionId).toBe('act_t2')
  })

  it('older reply: deeper cascade through the same sweep, regenerating from that action', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)

    const regen = await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r1', ctx)

    expect(regen.status).toBe('ran')
    if (regen.status !== 'ran') return
    expect(expectRan(regen.result).outcome).toBe('completed')

    const rows = branchEntries('b1').sort((a, b) => a.position - b.position)
    expect(rows.map((r) => r.id)).toEqual(['e_opening', 'e_u1', rows[2].id])
    expect(rows[2].kind).toBe('ai_reply')
    expect(rows[2].content).toBe('A new take.')
    expect(await ctx.db.select().from(happenings)).toEqual([])
  })
})
