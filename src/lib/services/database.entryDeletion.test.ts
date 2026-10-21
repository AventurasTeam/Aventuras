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

function submittedStatements(): { sql: string; params: unknown[] }[] {
  expect(mocks.invoke).toHaveBeenCalledOnce()
  const [, payload] = mocks.invoke.mock.calls[0] as unknown as [
    string,
    { statements: { sql: string; params: unknown[] }[] },
  ]
  return payload.statements
}

const squashed = (sql: string) => sql.replace(/\s+/g, ' ').trim()

describe('deleting entries without a rollback', () => {
  beforeEach(async () => {
    await database.close()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await database.close()
  })

  it("moves the entries' changes and breaks to the entry before, before deleting them", async () => {
    await database.deleteEntriesWithDependents({ entryIds: ['e9'], recordsTo: 'e8' })

    const statements = submittedStatements()
    expect(squashed(statements[0].sql)).toBe(
      "UPDATE world_state_changes SET entry_id = ? WHERE (kind IN ('change', 'break') OR (kind = 'header' AND continuous = 0 AND origin IS NULL)) AND entry_id IN (?)",
    )
    expect(statements[0].params).toEqual(['e8', 'e9'])
    expect(statements.at(-1)?.sql).toContain('DELETE FROM story_entries')
  })

  it('moves nothing without an entry to move to', async () => {
    await database.deleteEntriesWithDependents({ entryIds: ['e1'] })

    expect(submittedStatements().some((s) => s.sql.includes('UPDATE world_state_changes'))).toBe(
      false,
    )
  })
})
