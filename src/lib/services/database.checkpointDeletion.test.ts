import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    checkpointIds: new Set<string>(),
    branchCheckpointIds: new Set<string>(),
  }
  const execute = vi.fn(async (sql: string, bindValues?: unknown[]) => {
    if (!sql.includes('DELETE FROM checkpoints')) return { rowsAffected: 0 }

    const checkpointId = bindValues?.[0] as string
    const exists = state.checkpointIds.has(checkpointId)
    const referenced = state.branchCheckpointIds.has(checkpointId)
    const guarded = sql.includes('NOT EXISTS (SELECT 1 FROM branches WHERE checkpoint_id = ?)')
    if (exists && (!referenced || !guarded)) {
      state.checkpointIds.delete(checkpointId)
      return { rowsAffected: 1 }
    }
    return { rowsAffected: 0 }
  })
  const close = vi.fn(async () => {})
  const connection = { execute, close }
  const load = vi.fn(async () => connection)
  return { state, execute, close, load }
})

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: mocks.load },
}))

import { database } from './database'

describe('checkpoint deletion persistence guard', () => {
  beforeEach(async () => {
    await database.close()
    vi.clearAllMocks()
    mocks.state.checkpointIds.clear()
    mocks.state.branchCheckpointIds.clear()
  })

  afterEach(async () => {
    await database.close()
  })

  it('deletes only when no branch references the checkpoint', async () => {
    mocks.state.checkpointIds.add('cp-1')

    await expect(database.deleteCheckpoint('cp-1')).resolves.toBeUndefined()

    const deleteCall = mocks.execute.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM checkpoints'),
    )
    expect(deleteCall?.[0]).toContain('NOT EXISTS (SELECT 1 FROM branches WHERE checkpoint_id = ?)')
    expect(deleteCall?.[1]).toEqual(['cp-1', 'cp-1'])
    expect(mocks.state.checkpointIds.has('cp-1')).toBe(false)
  })

  it('refuses a checkpoint referenced by a branch without altering either record', async () => {
    mocks.state.checkpointIds.add('cp-1')
    mocks.state.branchCheckpointIds.add('cp-1')

    await expect(database.deleteCheckpoint('cp-1')).rejects.toThrow(
      'does not exist or was used to create a branch',
    )
    expect(mocks.state.checkpointIds.has('cp-1')).toBe(true)
    expect(mocks.state.branchCheckpointIds.has('cp-1')).toBe(true)
  })

  it('refuses a checkpoint that is absent from persistence', async () => {
    await expect(database.deleteCheckpoint('missing-cp')).rejects.toThrow(
      'does not exist or was used to create a branch',
    )
    expect(mocks.state.checkpointIds.size).toBe(0)
    expect(mocks.state.branchCheckpointIds.size).toBe(0)
  })

  it('keeps batch cleanup tolerant when one in-memory checkpoint is already absent', async () => {
    mocks.state.checkpointIds.add('present-cp')

    await expect(
      database.deleteCheckpoints(['present-cp', 'already-missing-cp']),
    ).resolves.toBeUndefined()
    expect(mocks.state.checkpointIds.has('present-cp')).toBe(false)
  })
})
