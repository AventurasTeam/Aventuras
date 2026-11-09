import { readFileSync } from 'node:fs'

import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  getRollbackCounts,
  openStory,
  redoLastAction,
  rollbackToEntry,
  undoLastAction,
  type RollbackCounts,
} from '@/lib/actions'
import { chaptersStore, entitiesStore, resetAllStores } from '@/lib/stores'
import { selectUndoTarget } from '@/lib/undo'

import { exportStorySeed } from './seed-export'
import { createTestDb } from '../../lib/db/__tests__/test-db'
import { buildSeedSteps } from '../../lib/db/devtools/seed-dataset'
import {
  chapters,
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  stories,
  storyEntries,
  threads,
} from '../../lib/db/schema'
import type { Delta } from '../../lib/db/types'
import { DATASET_SEED_PATH, datasetStorySteps, seedAppRefs } from '../seed/dataset-story'
import { insertSeedSteps } from '../seed/insert'

const STORY = 'story_77a59fe9-7741-4634-b6cd-5633f9e50f5b'
const BRANCH = 'br_aa6101af-d3dd-4964-9869-81e76cc35f97'
const JIM = 'char_25b8a728-1ab9-4ee6-994d-0a44dd2ea897'

async function seededWithDataset() {
  const ctx = await createTestDb()
  const defaults = buildSeedSteps()
  await insertSeedSteps(ctx.db, [...defaults, ...datasetStorySteps(seedAppRefs(defaults))])
  return ctx
}

type Ctx = Awaited<ReturnType<typeof seededWithDataset>>

async function branchCount(ctx: Ctx, table: typeof entities | typeof deltas | typeof storyEntries) {
  const [row] = await ctx.db.select({ n: count() }).from(table).where(eq(table.branchId, BRANCH))
  return row!.n
}

const openRegion = async (ctx: Ctx) =>
  (
    await ctx.db
      .select({ n: count() })
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, BRANCH), isNull(storyEntries.chapterId)))
  )[0]!.n

const locationOf = async (ctx: Ctx, id: string) => {
  const [row] = await ctx.db
    .select({ state: entities.state })
    .from(entities)
    .where(and(eq(entities.branchId, BRANCH), eq(entities.id, id)))
  return (row?.state as { current_location_id?: string | null } | undefined)?.current_location_id
}

const chapterRows = (ctx: Ctx) =>
  ctx.db.select().from(chapters).where(eq(chapters.branchId, BRANCH))

describe('the Treasure Island seed', () => {
  afterEach(() => {
    resetAllStores()
  })

  it('loads after the default seed with the counts its build left', async () => {
    const ctx = await seededWithDataset()
    const counts: Record<string, number> = {}
    for (const [name, table] of Object.entries({
      story_entries: storyEntries,
      chapters,
      entities,
      lore,
      threads,
      happenings,
      happening_involvements: happeningInvolvements,
      happening_awareness: happeningAwareness,
      character_relationships: characterRelationships,
      deltas,
    }))
      counts[name] = await branchCount(ctx, table as typeof entities)
    expect(counts).toEqual({
      story_entries: 133,
      chapters: 1,
      entities: 56,
      lore: 0,
      threads: 7,
      happenings: 37,
      happening_involvements: 134,
      happening_awareness: 72,
      character_relationships: 6,
      deltas: 1033,
    })
    const storyIds = (await ctx.db.select({ id: stories.id }).from(stories)).map((r) => r.id)
    const defaultStories = buildSeedSteps()
      .filter((s) => s.table === stories)
      .flatMap((s) => (s.rows as { id: string }[]).map((r) => r.id))
    expect(storyIds.toSorted()).toEqual([...defaultStories, STORY].toSorted())
    expect(await openRegion(ctx)).toBe(0)
  })

  it('opens', async () => {
    const ctx = await seededWithDataset()
    expect(await openStory(STORY, ctx, () => {})).toEqual({ status: 'ok', branchId: BRANCH })
    expect(entitiesStore.getLoadedBranch()).toBe(BRANCH)
    expect(entitiesStore.getEntities().size).toBe(56)
    expect([...chaptersStore.getChapters().values()].map((c) => c.title)).toEqual([
      'The Admiral Benbow and the Treasure Map',
    ])
  })

  it('undoes its close to an open chapter of all 133 entries, and redoes it', async () => {
    const ctx = await seededWithDataset()
    await openStory(STORY, ctx, () => {})
    const log = (await ctx.db
      .select()
      .from(deltas)
      .where(eq(deltas.branchId, BRANCH))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    const close = log.filter((d) => d.source === 'chapter_close')
    expect(selectUndoTarget(log)).toEqual({ actionId: close[0]!.actionId, kind: 'group' })
    expect(close).toHaveLength(151)
    const closed = await chapterRows(ctx)

    expect(await undoLastAction(BRANCH, ctx)).toEqual({ status: 'ok' })
    expect(await chapterRows(ctx)).toEqual([])
    expect(await openRegion(ctx)).toBe(133)
    expect(await branchCount(ctx, deltas)).toBe(1033 - 151)

    expect(await redoLastAction(BRANCH, ctx)).toEqual({ status: 'ok' })
    expect(await chapterRows(ctx)).toEqual(closed)
    expect(await openRegion(ctx)).toBe(0)
    const chapterOf = await ctx.db
      .selectDistinct({ chapterId: storyEntries.chapterId })
      .from(storyEntries)
      .where(eq(storyEntries.branchId, BRANCH))
      .orderBy(asc(storyEntries.chapterId))
    expect(chapterOf).toEqual([{ chapterId: closed[0]!.id }])
    expect(await branchCount(ctx, deltas)).toBe(1033)
  })

  // A rollback reads a close's anchors, which a CTRL-Z of the close never does (C1).
  it('rolls back into its chapter, taking the close with it', async () => {
    const ctx = await seededWithDataset()
    await openStory(STORY, ctx, () => {})
    const [target] = await ctx.db
      .select({ id: storyEntries.id })
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, BRANCH), eq(storyEntries.position, 60)))
    const counts = await getRollbackCounts(BRANCH, target!.id, ctx)
    expect(counts).toMatchObject({ entries: 74, chapters: 1 })
    expect(await locationOf(ctx, JIM)).toBe('loc_106c83c1-2c15-4bba-901f-16953816f627')

    const result = await rollbackToEntry(BRANCH, target!.id, ctx, {
      expectedCounts: counts as RollbackCounts,
    })
    expect(result.status).toBe('ok')
    expect(await chapterRows(ctx)).toEqual([])
    expect(await branchCount(ctx, storyEntries)).toBe(59)
    expect(await openRegion(ctx)).toBe(59)
    // Turn 60's pass moved Jim first after entry 59; its undo payload holds where he stood.
    expect(await locationOf(ctx, JIM)).toBe('loc_5d52592d-0a05-4dda-979b-eaafa1d86247')
  })

  // A migration adding a column to a seeded table fails here: the file lacks it until re-exported.
  it('exports to the bytes it loaded from', async () => {
    const { sqlite } = await seededWithDataset()
    const exported = await exportStorySeed(sqlite, STORY, seedAppRefs(buildSeedSteps()))
    expect(
      exported === readFileSync(DATASET_SEED_PATH, 'utf8'),
      'the seed differs from its own export: run pnpm db:seed:dataset, then pnpm dataset:export-seed, and commit the file',
    ).toBe(true)
  })
})
