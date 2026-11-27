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
})
