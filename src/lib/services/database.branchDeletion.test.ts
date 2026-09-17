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

/** The statements of the single `db_transaction` batch the call under test submitted. */
function submittedStatements(): { sql: string; params: unknown[] }[] {
  expect(mocks.invoke).toHaveBeenCalledOnce()
  const [command, payload] = mocks.invoke.mock.calls[0] as unknown as [
    string,
    { statements: { sql: string; params: unknown[] }[] },
  ]
  expect(command).toBe('db_transaction')
  return payload.statements
}

const squashed = (sql: string) => sql.replace(/\s+/g, ' ').trim()

describe('atomic branch deletion', () => {
  beforeEach(async () => {
    await database.close()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await database.close()
  })

  it('submits checkpoint cleanup and every branch delete in one transaction', async () => {
    await database.deleteBranch('branch-1')

    const statements = submittedStatements()
    expect(statements.map((statement) => squashed(statement.sql))).toEqual([
      'DELETE FROM checkpoints WHERE id IN ( SELECT c.id FROM checkpoints c ' +
        'JOIN story_entries e ON e.id = c.last_entry_id WHERE e.branch_id = ?)',
      'DELETE FROM chapters WHERE branch_id = ?',
      'DELETE FROM story_entries WHERE branch_id = ?',
      'DELETE FROM characters WHERE branch_id = ?',
      'DELETE FROM locations WHERE branch_id = ?',
      'DELETE FROM items WHERE branch_id = ?',
      'DELETE FROM story_beats WHERE branch_id = ?',
      'DELETE FROM entries WHERE branch_id = ?',
      'DELETE FROM branches WHERE id = ?',
    ])
    for (const statement of statements) {
      expect(statement.params).toEqual(['branch-1'])
    }

    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.execute).toHaveBeenCalledWith('PRAGMA foreign_keys = ON')
  })

  it('takes no checkpoint ids from the caller', async () => {
    await database.deleteBranch('branch-1')

    // The whole point of the subselect: nothing the caller holds can widen or narrow the set.
    for (const statement of submittedStatements()) {
      expect(statement.params).toEqual(['branch-1'])
    }
  })

  it('selects the branch-owned checkpoints through the entries it then deletes', async () => {
    await database.deleteBranch('branch-1')

    const statements = submittedStatements()
    const checkpointDelete = statements.findIndex((statement) =>
      statement.sql.includes('DELETE FROM checkpoints'),
    )
    const entriesDelete = statements.findIndex((statement) =>
      statement.sql.includes('DELETE FROM story_entries'),
    )

    // Ownership is read from story_entries, so the read has to precede the delete that empties it.
    expect(checkpointDelete).toBeGreaterThanOrEqual(0)
    expect(checkpointDelete).toBeLessThan(entriesDelete)
    expect(squashed(statements[checkpointDelete].sql)).toContain(
      'JOIN story_entries e ON e.id = c.last_entry_id WHERE e.branch_id = ?',
    )
  })

  it('spares a checkpoint anchored outside the branch', async () => {
    await database.deleteBranch('branch-1')

    const [checkpointDelete] = submittedStatements()
    // An inherited checkpoint's anchor carries an ancestor's branch_id, which the predicate
    // excludes; nothing widens the delete to every checkpoint the branch could see.
    expect(squashed(checkpointDelete.sql)).toContain('WHERE e.branch_id = ?')
    expect(squashed(checkpointDelete.sql)).not.toContain('story_id')
  })

  it('propagates a transaction failure without falling back to separate deletes', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('branch delete failed'))

    await expect(database.deleteBranch('branch-1')).rejects.toThrow('branch delete failed')

    expect(mocks.invoke).toHaveBeenCalledOnce()
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.execute).toHaveBeenCalledWith('PRAGMA foreign_keys = ON')
  })

  it('removes no checkpoint when a later statement fails', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('entries delete failed'))

    await expect(database.deleteBranch('branch-1')).rejects.toThrow('entries delete failed')

    // One batch, so the checkpoint delete rolls back with everything after it; nothing is
    // submitted separately that could have committed on its own.
    expect(mocks.invoke).toHaveBeenCalledOnce()
  })
})
