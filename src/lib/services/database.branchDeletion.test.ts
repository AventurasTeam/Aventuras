import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const execute = vi.fn(async () => ({ rowsAffected: 0 }))
  const close = vi.fn(async () => {})
  const connection = { execute, close }
  const load = vi.fn(async () => connection)
  const invoke = vi.fn(async () => [] as number[])
  return { execute, close, load, invoke }
})

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: mocks.load },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

import { database } from './database'

describe('atomic branch deletion', () => {
  beforeEach(async () => {
    await database.close()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await database.close()
  })

  it('submits checkpoint cleanup and every branch delete in one transaction', async () => {
    await database.deleteBranch('branch-1', ['cp-1', 'already-missing-cp'])

    expect(mocks.invoke).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('db_transaction', {
      statements: [
        {
          sql: 'DELETE FROM checkpoints WHERE id IN (?,?)',
          params: ['cp-1', 'already-missing-cp'],
        },
        { sql: 'DELETE FROM chapters WHERE branch_id = ?', params: ['branch-1'] },
        { sql: 'DELETE FROM story_entries WHERE branch_id = ?', params: ['branch-1'] },
        { sql: 'DELETE FROM characters WHERE branch_id = ?', params: ['branch-1'] },
        { sql: 'DELETE FROM locations WHERE branch_id = ?', params: ['branch-1'] },
        { sql: 'DELETE FROM items WHERE branch_id = ?', params: ['branch-1'] },
        { sql: 'DELETE FROM story_beats WHERE branch_id = ?', params: ['branch-1'] },
        { sql: 'DELETE FROM entries WHERE branch_id = ?', params: ['branch-1'] },
        { sql: 'DELETE FROM branches WHERE id = ?', params: ['branch-1'] },
      ],
    })
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.execute).toHaveBeenCalledWith('PRAGMA foreign_keys = ON')
  })

  it('propagates a transaction failure without falling back to separate deletes', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('branch delete failed'))

    await expect(database.deleteBranch('branch-1', ['cp-1'])).rejects.toThrow(
      'branch delete failed',
    )

    expect(mocks.invoke).toHaveBeenCalledOnce()
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.execute).toHaveBeenCalledWith('PRAGMA foreign_keys = ON')
  })
})
