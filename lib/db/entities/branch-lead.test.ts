import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'

import { createTestDb } from '../__tests__/test-db'
import { branches, entities, stories } from '../schema'
import type { NewEntity } from '../types'
import { readBranchLead } from './branch-lead'

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']

const character = (id: string, branchId: string, over: Partial<NewEntity> = {}): NewEntity => ({
  id,
  branchId,
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

// Rows go in as listed: put a sibling's first, so a read by flag or id alone meets it first.
async function seed(rows: NewEntity[]): Promise<TestDb> {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
  for (const row of rows) await db.insert(entities).values(row)
  return db
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readBranchLead', () => {
  it("returns the named branch's one flagged character", async () => {
    const db = await seed([
      character('char_mira', 'b1'),
      character('char_kael', 'b1', { isLead: 1 }),
    ])
    expect((await readBranchLead('b1', db))?.id).toBe('char_kael')
  })

  it('returns null when no row on the branch carries the flag', async () => {
    const db = await seed([character('char_kael', 'b1'), character('char_mira', 'b1')])
    expect(await readBranchLead('b1', db)).toBeNull()
  })

  it('returns null with two flagged rows, logging the double once with their ids in order', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const db = await seed([
      character('char_mira', 'b1', { isLead: 1 }),
      character('char_kael', 'b1', { isLead: 1 }),
    ])

    expect(await readBranchLead('b1', db)).toBeNull()

    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('action_layer.branch_lead_double', {
      branchId: 'b1',
      ids: ['char_kael', 'char_mira'],
    })
  })

  it("never returns another branch's row with the same id", async () => {
    const db = await seed([
      character('char_kael', 'b2', { isLead: 1, name: 'Kael of the fork' }),
      character('char_kael', 'b1'),
    ])
    expect(await readBranchLead('b1', db)).toBeNull()
    expect((await readBranchLead('b2', db))?.name).toBe('Kael of the fork')
  })

  it.each(['retired', 'staged'] as const)(
    'keeps a %s flagged character as the lead',
    async (status) => {
      const db = await seed([character('char_kael', 'b1', { isLead: 1, status })])
      expect((await readBranchLead('b1', db))?.id).toBe('char_kael')
    },
  )

  it('logs nothing for a branch with one lead or none', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const db = await seed([character('char_kael', 'b1', { isLead: 1 })])
    await readBranchLead('b1', db)
    await readBranchLead('b2', db)
    expect(error).not.toHaveBeenCalled()
  })
})
