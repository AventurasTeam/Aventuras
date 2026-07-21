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
  deleteBranchVecOps,
  ensureVecTablesSql,
  isVecFamilyTable,
  vaultCalendars,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { rehydrateStories, storiesStore } from '@/lib/stores'

import { BRANCH_SCOPED, deleteStory } from './delete-story'

async function setup() {
  const { db, sqlite, runInTransaction } = await createTestDb()
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
  const listTables = async (): Promise<string[]> =>
    (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string
      }[]
    ).map((row) => row.name)
  return { db, sqlite, listTables, ctx: { db, runInTransaction } }
}

describe('deleteStory', () => {
  it('removes the whole owned graph and leaves other stories + vault intact', async () => {
    const { db, listTables, ctx } = await setup()
    await deleteStory('victim', ctx, listTables)

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

  it('prunes only the deleted story failure and does not restore it when the id is reused', async () => {
    const { db, listTables, ctx } = await setup()
    storiesStore.setOpenFailure({ storyId: 'victim', kind: 'settings-corrupt' })
    storiesStore.setOpenFailure({ storyId: 'survivor', kind: 'definition-corrupt' })

    await deleteStory('victim', ctx, listTables)

    expect(storiesStore.getStories().openFailures).toEqual({
      survivor: 'definition-corrupt',
    })

    await db.insert(stories).values({
      id: 'victim',
      title: 'replacement',
      status: 'active',
      favorite: 0,
      createdAt: 2,
      updatedAt: 2,
    })
    await rehydrateStories(db)

    expect(storiesStore.getStories().openFailures).toEqual({
      survivor: 'definition-corrupt',
    })
  })

  it('is a no-op-safe full sweep across every owned table (empty tables included)', async () => {
    const { db, listTables, ctx } = await setup()
    await deleteStory('victim', ctx, listTables)
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

describe('deleteStory — vec0 cleanup', () => {
  // vec0 tables are virtual, so they are invisible to dbSchema and to any
  // Drizzle cascade; nothing but an explicit delete reaches them.
  type Sqlite = Awaited<ReturnType<typeof setup>>['sqlite']

  function seedVectors(sqlite: Sqlite) {
    // A second dim family, as a kept or abandoned model swap would leave behind.
    for (const stmt of ensureVecTablesSql(768)) sqlite.exec(stmt)
    for (const dim of [384, 768]) {
      for (const story of ['victim', 'survivor']) {
        sqlite.exec(
          `INSERT INTO entities_vec_${dim} (pk, branch_id, model_id, id, source_hash, embedding)
           VALUES ('br_${story}:c_${story}', 'br_${story}', 'm', 'c_${story}', 'h',
           vec_f32('[${Array(dim).fill('0.1').join(',')}]'))`,
        )
      }
    }
  }

  function vecBranches(sqlite: Sqlite, dim: number): string[] {
    return (
      sqlite.prepare(`SELECT branch_id FROM entities_vec_${dim} ORDER BY branch_id`).all() as {
        branch_id: string
      }[]
    ).map((r) => r.branch_id)
  }

  it('removes the deleted story vectors from every dim family, keeping other branches', async () => {
    const { sqlite, listTables, ctx } = await setup()
    seedVectors(sqlite)
    expect(vecBranches(sqlite, 384)).toEqual(['br_survivor', 'br_victim'])
    expect(vecBranches(sqlite, 768)).toEqual(['br_survivor', 'br_victim'])

    await deleteStory('victim', ctx, listTables)

    expect(vecBranches(sqlite, 384)).toEqual(['br_survivor'])
    expect(vecBranches(sqlite, 768)).toEqual(['br_survivor'])
  })

  it('skips vec0 shadow tables, which reject DML', async () => {
    const { listTables } = await setup()
    const names = await listTables()

    // The shadow tables exist and must not be matched.
    expect(names).toContain('entities_vec_384_info')
    expect(names.filter(isVecFamilyTable)).toContain('entities_vec_384')
    expect(names.filter(isVecFamilyTable)).not.toContain('entities_vec_384_info')
  })

  it('builds no ops when the story had no branches', () => {
    expect(deleteBranchVecOps(['entities_vec_384'], [])).toEqual([])
  })
})
