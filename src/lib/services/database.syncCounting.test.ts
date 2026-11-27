import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const execute = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowsAffected: 0 }))
  const select = vi.fn(async (_sql: string): Promise<unknown[]> => [])
  const close = vi.fn(async () => {})
  const connection = { execute, select, close }
  const load = vi.fn(async () => connection)
  const invoke = vi.fn(async (_command: string, _payload: unknown) => [] as number[])
  return { execute, select, close, load, invoke }
})

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: mocks.load },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

import { database } from './database'

type Submitted = { sql: string; params: unknown[] }[]

function submittedStatements(): Submitted {
  expect(mocks.invoke).toHaveBeenCalledOnce()
  const [command, payload] = mocks.invoke.mock.calls[0]
  expect(command).toBe('db_transaction')
  return (payload as { statements: Submitted }).statements
}

const squashed = (sql: string) => sql.replace(/\s+/g, ' ').trim()

describe('writes sync does not count', () => {
  beforeEach(async () => {
    await database.close()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await database.close()
  })

  it('releases the migration hold before anything else writes', async () => {
    await database.init()

    const sql = mocks.execute.mock.calls.map(([statement]) => statement)
    expect(sql).toContain("DELETE FROM sync_suspend WHERE reason = 'migration'")
  })

  it('wraps the statements in one transaction that holds and releases suspend', async () => {
    mocks.invoke.mockResolvedValueOnce([1, 4, 2, 1])

    const counts = await database.withoutSyncCounting('why', [
      { sql: 'UPDATE a SET x = 1', params: [] },
      { sql: 'DELETE FROM b', params: [] },
    ])

    const statements = submittedStatements()
    expect(statements.map(({ sql }) => sql)).toEqual([
      'INSERT INTO sync_suspend (reason) VALUES (?)',
      'UPDATE a SET x = 1',
      'DELETE FROM b',
      'DELETE FROM sync_suspend WHERE reason = ?',
    ])
    expect(statements[0].params).toEqual(['why'])
    expect(statements[3].params).toEqual(['why'])
    expect(counts).toEqual([4, 2])
  })

  it('submits nothing for no statements', async () => {
    await expect(database.withoutSyncCounting('why', [])).resolves.toEqual([])
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('settles interrupted images under suspend, and only when some are unfinished', async () => {
    await expect(database.failInterruptedEmbeddedImages()).resolves.toBe(0)
    expect(mocks.invoke).not.toHaveBeenCalled()

    mocks.select.mockResolvedValueOnce([{ 1: 1 }])
    mocks.invoke.mockResolvedValueOnce([1, 3, 1])
    await expect(database.failInterruptedEmbeddedImages()).resolves.toBe(3)

    const statements = submittedStatements()
    expect(statements[0].sql).toContain('sync_suspend')
    expect(squashed(statements[1].sql)).toContain('UPDATE embedded_images SET')
    expect(statements[1].params).toEqual(['Interrupted'])
  })

  it('deletes orphaned images under suspend, and only when there are some', async () => {
    await expect(database.cleanupOrphanedEmbeddedImages()).resolves.toBe(0)
    expect(mocks.invoke).not.toHaveBeenCalled()

    mocks.select.mockResolvedValueOnce([{ 1: 1 }])
    mocks.invoke.mockResolvedValueOnce([1, 2, 1])
    await expect(database.cleanupOrphanedEmbeddedImages()).resolves.toBe(2)
    expect(submittedStatements()[0].sql).toContain('sync_suspend')
  })

  it('removes broken chapters under suspend', async () => {
    await database.deleteBrokenChapters(['c1', 'c2'])

    const statements = submittedStatements()
    expect(statements[0].sql).toContain('sync_suspend')
    expect(statements[1]).toEqual({
      sql: 'DELETE FROM chapters WHERE id IN (?,?)',
      params: ['c1', 'c2'],
    })
  })
})
