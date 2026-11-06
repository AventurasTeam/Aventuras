import { count } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { insertSeedSteps } from './insert'
import { replaceSeedRows } from './replace'
import { createTestDb } from '../../lib/db/__tests__/test-db'
import { buildSeedSteps, type SeedStep } from '../../lib/db/devtools/seed-dataset'
import { branches, stories } from '../../lib/db/schema'

async function seeded() {
  const ctx = await createTestDb()
  await insertSeedSteps(ctx.db, buildSeedSteps())
  return ctx
}

type Ctx = Awaited<ReturnType<typeof seeded>>
const storyCount = async ({ db }: Ctx) => (await db.select({ n: count() }).from(stories))[0]!.n

const extraStory = {
  id: 'story_extra',
  title: 'Extra',
  status: 'active' as const,
  createdAt: 1,
  updatedAt: 1,
}

describe('replaceSeedRows', () => {
  it('replaces every row with the steps', async () => {
    const ctx = await seeded()
    await ctx.db.insert(stories).values(extraStory)
    await replaceSeedRows(ctx.sqlite, ctx.db, buildSeedSteps())
    expect(await storyCount(ctx)).toBe(7)
  })

  it('keeps the old rows when an insert fails', async () => {
    const ctx = await seeded()
    const steps = buildSeedSteps()
    const duplicate = steps.find((s) => s.table === stories)!
    await expect(replaceSeedRows(ctx.sqlite, ctx.db, [...steps, duplicate])).rejects.toThrow()
    expect(await storyCount(ctx)).toBe(7)
  })

  it('keeps the old rows when a reference is broken', async () => {
    const ctx = await seeded()
    const orphan: SeedStep = {
      name: 'branches',
      table: branches,
      rows: [{ id: 'br_orphan', storyId: 'story_missing', name: 'Orphan', createdAt: 1 }],
    }
    await expect(
      replaceSeedRows(ctx.sqlite, ctx.db, [...buildSeedSteps(), orphan]),
    ).rejects.toThrow(/FOREIGN KEY/)
    expect(await storyCount(ctx)).toBe(7)
  })
})
