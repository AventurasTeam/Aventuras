import { getTableColumns, getTableName } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import {
  branchEraFlips,
  branches,
  chapters,
  characterRelationships,
  dbSchema,
  deltas,
  entities,
  entryAssets,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  pipelineRuns,
  probeCaptures,
  stories,
  storyEntries,
  threads,
  translations,
  vaultCalendars,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { storiesStore } from '@/lib/stores'

import { BRANCH_SCOPED, deleteStory } from './delete-story'

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  // Two stories so we can prove the survivor is untouched.
  for (const id of ['victim', 'survivor']) {
    await db.insert(stories).values({
      id,
      title: id,
      status: 'active',
      favorite: 0,
      createdAt: 1,
      updatedAt: 1,
      currentBranchId: `br_${id}`,
    })
    await db.insert(branches).values({ id: `br_${id}`, storyId: id, name: 'main', createdAt: 1 })
    await db.insert(storyEntries).values({
      id: `e_${id}`,
      branchId: `br_${id}`,
      position: 0,
      kind: 'opening',
      content: 'x',
      createdAt: 1,
    })
    await db.insert(entities).values({
      id: `c_${id}`,
      branchId: `br_${id}`,
      kind: 'character',
      name: 'K',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    await db.insert(pipelineRuns).values({
      runId: `run_${id}`,
      kind: 'generate',
      actionId: `act_${id}`,
      storyId: id,
      startedAt: 1,
    })
  }
  // Shared vault calendar must survive.
  await db
    .insert(vaultCalendars)
    .values({ id: 'cal_1', name: 'Earth', favorite: 0, createdAt: 1, updatedAt: 1 })
  storiesStore.__reset() // deleteStory re-hydrates at the end; this clears cross-test state
  return { db, ctx: { db, runInTransaction } }
}

describe('deleteStory', () => {
  it('removes the whole owned graph and leaves other stories + vault intact', async () => {
    const { db, ctx } = await setup()
    await deleteStory('victim', ctx)

    expect((await db.select().from(stories)).map((r) => r.id)).toEqual(['survivor'])
    expect((await db.select().from(branches)).map((r) => r.id)).toEqual(['br_survivor'])
    expect((await db.select().from(storyEntries)).map((r) => r.branchId)).toEqual(['br_survivor'])
    expect((await db.select().from(entities)).map((r) => r.branchId)).toEqual(['br_survivor'])
    expect((await db.select().from(pipelineRuns)).map((r) => r.storyId)).toEqual(['survivor'])
    // Shared vault calendar untouched.
    expect((await db.select().from(vaultCalendars)).length).toBe(1)
    // Store reflects the delete.
    expect(storiesStore.getStories().rows.map((r) => r.id)).toEqual(['survivor'])
  })

  it('is a no-op-safe full sweep across every owned table (empty tables included)', async () => {
    const { db, ctx } = await setup()
    await deleteStory('victim', ctx)
    for (const t of [
      chapters,
      lore,
      threads,
      happenings,
      happeningInvolvements,
      happeningAwareness,
      characterRelationships,
      branchEraFlips,
      translations,
      probeCaptures,
      deltas,
      entryAssets,
    ]) {
      const rows = await db.select().from(t)
      // None belonged to the victim branch; survivor's (none seeded) remain absent.
      expect(rows.every((r) => !('branchId' in r) || r.branchId !== 'br_victim')).toBe(true)
    }
  })

  it('cascade covers exactly the schema branch-scoped tables (no future orphans)', () => {
    // Every table carrying a branch_id is owned-by-story content in this schema, so it
    // MUST be in the cascade. This guards against a table being dropped from BRANCH_SCOPED
    // or a new branch-scoped table being added to the schema without wiring the cascade.
    const schemaBranchTables = (Object.values(dbSchema) as SQLiteTable[])
      .filter((t) => 'branchId' in getTableColumns(t))
      .map(getTableName)
      .sort()
    const cascadeTables = BRANCH_SCOPED.map(getTableName).sort()
    expect(cascadeTables).toEqual(schemaBranchTables)
  })
})
