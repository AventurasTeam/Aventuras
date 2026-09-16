import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const execute = vi.fn(async () => ({ rowsAffected: 0 }))
  const select = vi.fn(async () => [] as any[])
  const close = vi.fn(async () => {})
  const connection = { execute, select, close }
  const load = vi.fn(async () => connection)
  const invoke = vi.fn(async () => [] as number[])
  return { execute, select, close, load, invoke }
})

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: mocks.load },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

import { database } from './database'

/** A row as the checkpoint select returns it, with the anchor columns the join contributes. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cp-1',
    story_id: 'story-1',
    name: 'Council of five',
    last_entry_id: 'entry-1',
    last_entry_preview: 'They gathered.',
    entry_count: 12,
    characters_snapshot: '[]',
    locations_snapshot: '[]',
    items_snapshot: '[]',
    story_beats_snapshot: '[]',
    chapters_snapshot: '[]',
    time_tracker_snapshot: null,
    lorebook_entries_snapshot: null,
    created_at: 1700000000000,
    anchor_branch_id: 'branch-1',
    anchored: 1,
    ...overrides,
  }
}

const lastSelect = () => mocks.select.mock.calls[0] as unknown as [string, unknown[]]
const squashed = (sql: string) => sql.replace(/\s+/g, ' ').trim()

describe('checkpoint load', () => {
  beforeEach(async () => {
    await database.close()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await database.close()
  })

  it('resolves ownership from the anchoring entry', async () => {
    mocks.select.mockResolvedValueOnce([row()])

    const [checkpoint] = await database.getCheckpoints('story-1')

    expect(checkpoint.branchId).toBe('branch-1')
    expect(checkpoint.anchored).toBe(true)
  })

  it('reads an anchor on the main branch as null rather than orphaned', async () => {
    mocks.select.mockResolvedValueOnce([row({ anchor_branch_id: null, anchored: 1 })])

    const [checkpoint] = await database.getCheckpoints('story-1')

    expect(checkpoint.branchId).toBeNull()
    expect(checkpoint.anchored).toBe(true)
  })

  it('marks a checkpoint whose anchor is gone as unanchored', async () => {
    mocks.select.mockResolvedValueOnce([row({ anchor_branch_id: null, anchored: 0 })])

    const [checkpoint] = await database.getCheckpoints('story-1')

    expect(checkpoint.anchored).toBe(false)
  })

  it('keeps the orphan in the result rather than dropping it', async () => {
    mocks.select.mockResolvedValueOnce([
      row(),
      row({ id: 'cp-2', anchor_branch_id: null, anchored: 0 }),
    ])

    const checkpoints = await database.getCheckpoints('story-1')

    // An inner join would return one row here, and the orphan would never reach the panel.
    expect(checkpoints.map((checkpoint) => checkpoint.id)).toEqual(['cp-1', 'cp-2'])
  })

  it('leaves the entry snapshot unread', async () => {
    mocks.select.mockResolvedValueOnce([row()])

    const [checkpoint] = await database.getCheckpoints('story-1')

    expect(checkpoint).not.toHaveProperty('entriesSnapshot')
    // Not a bare substring check: `lorebook_entries_snapshot` is selected and contains it.
    expect(squashed(lastSelect()[0])).not.toContain('c.entries_snapshot')
  })

  it('carries the snapshots a branch is seeded from', async () => {
    mocks.select.mockResolvedValueOnce([
      row({ characters_snapshot: '[{"id":"char-1"}]', time_tracker_snapshot: '{"days":3}' }),
    ])

    const [checkpoint] = await database.getCheckpoints('story-1')

    expect(checkpoint.charactersSnapshot).toEqual([{ id: 'char-1' }])
    expect(checkpoint.timeTrackerSnapshot).toEqual({ days: 3 })
  })

  it('reads the whole row, entry snapshot included, for export', async () => {
    mocks.select.mockResolvedValueOnce([
      { ...row(), entries_snapshot: '[{"id":"entry-1","branchId":"branch-1"}]' },
    ])

    const [record] = await database.getCheckpointRecords('story-1')

    expect(record.entriesSnapshot).toEqual([{ id: 'entry-1', branchId: 'branch-1' }])
    expect(squashed(lastSelect()[0])).toContain('SELECT * FROM checkpoints')
  })
})
