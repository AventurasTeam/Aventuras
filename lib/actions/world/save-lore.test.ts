import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import type { Delta, Lore } from '@/lib/db'
import { branches, deltas, lore, stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { ID_PATTERN } from '@/lib/ids'
import { resetAllStores } from '@/lib/stores'
import { EMPTY_LORE_DRAFT, loreDraftFrom } from '@/lib/world'

import { saveLore } from './save-lore'
import { __resetRegistry } from '../delta/registry'
import { registerLore } from '../lore/register'

async function setup() {
  __resetRegistry()
  registerLore()
  resetAllStores()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  return { db, ctx: { db, runInTransaction } }
}

async function deltaRows(db: Awaited<ReturnType<typeof setup>>['db']): Promise<Delta[]> {
  return (await db.select().from(deltas).where(eq(deltas.branchId, 'br_1'))) as Delta[]
}

describe('saveLore', () => {
  it('creates a lore row under one action_id and reports its id', async () => {
    const { db, ctx } = await setup()
    const result = await saveLore(
      {
        branchId: 'br_1',
        row: null,
        draft: { ...EMPTY_LORE_DRAFT, title: 'The Aetherium', body: 'A sea of light.' },
      },
      ctx,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.id).toMatch(/^lore_/)
    expect(result.id).toMatch(ID_PATTERN)
    const [row] = await db.select().from(lore).where(eq(lore.id, result.id))
    expect(row).toMatchObject({
      title: 'The Aetherium',
      body: 'A sea of light.',
      injectionMode: 'auto',
    })
    const rows = await deltaRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ op: 'create', targetTable: 'lore', source: 'user_edit' })
  })

  it('a re-save of an untrimmed committed row no-ops, and a real change logs one update', async () => {
    const { db, ctx } = await setup()
    const created = await saveLore(
      {
        branchId: 'br_1',
        row: null,
        draft: { ...EMPTY_LORE_DRAFT, title: 'The Aetherium', body: 'A sea of light.' },
      },
      ctx,
    )
    if (created.status !== 'ok') throw new Error('create failed')

    // Simulates a classifier-style write: same content under different whitespace/casing.
    await db.update(lore).set({ title: '  The Aetherium  ' }).where(eq(lore.id, created.id))
    const [dirty] = (await db.select().from(lore).where(eq(lore.id, created.id))) as Lore[]
    const noop = await saveLore({ branchId: 'br_1', row: dirty, draft: loreDraftFrom(dirty) }, ctx)
    expect(noop).toEqual({ status: 'ok', id: dirty.id })
    expect(await deltaRows(db)).toHaveLength(1)

    const result = await saveLore(
      { branchId: 'br_1', row: dirty, draft: { ...loreDraftFrom(dirty), priority: 7 } },
      ctx,
    )
    expect(result.status).toBe('ok')
    const rows = await deltaRows(db)
    expect(rows).toHaveLength(2)
    const update = rows.find((d) => d.op === 'update')
    expect(update?.undoPayload).toEqual({ priority: 0 })
    expect(new Set(rows.map((d) => d.actionId)).size).toBe(2)
  })
})
