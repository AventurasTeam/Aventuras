import { getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createTestDb } from './test-db'
import {
  branchSnapshot,
  cloneBranch,
  CLONED_TABLES,
  seedCopyFixture,
  type BranchSnapshot,
} from './two-branch'

const flipped = (snapshot: BranchSnapshot, branchId: string): BranchSnapshot =>
  Object.fromEntries(
    Object.entries(snapshot).map(([table, rows]) => [
      table,
      rows.map((row) => ({ ...row, branch_id: branchId })),
    ]),
  )

describe('the two-branch fixture', () => {
  // Listed by hand: a new branch-scoped table must also get a row in the seed.
  it('clones every branch-scoped table but pipeline_runs', () => {
    expect(CLONED_TABLES.map((table) => getTableName(table)).sort()).toEqual([
      'branch_era_flips',
      'chapters',
      'character_relationships',
      'deltas',
      'entities',
      'entry_assets',
      'happening_awareness',
      'happening_involvements',
      'happenings',
      'lore',
      'probe_captures',
      'reversal_journals',
      'story_entries',
      'threads',
      'translations',
    ])
  })

  it('seeds a row in every cloned table, a system tail and a finished re-run heading the log', async () => {
    const t = await createTestDb()
    const fx = await seedCopyFixture(t)
    const seeded = branchSnapshot(t.sqlite, fx.branchId)

    expect(Object.keys(seeded).filter((table) => seeded[table].length === 0)).toEqual([])
    const tail = seeded.story_entries.reduce((a, b) =>
      Number(b.position) > Number(a.position) ? b : a,
    )
    expect(tail).toMatchObject({ id: fx.systemEntryId, kind: 'system' })
    expect(seeded.probe_captures.map((row) => row.id)).toEqual([...fx.probeCaptureIds])
    expect(seeded.reversal_journals.map((row) => row.action_id)).toEqual([fx.journalActionId])
    expect(
      t.sqlite
        .prepare(
          'SELECT action_id FROM deltas WHERE branch_id = ? ORDER BY log_position DESC LIMIT 1',
        )
        .get(fx.branchId),
    ).toMatchObject({ action_id: fx.journalActionId })
    expect(
      t.sqlite
        .prepare(
          'SELECT branch_id, action_id, finished_at IS NOT NULL AS finished FROM pipeline_runs WHERE run_id = ?',
        )
        .get(fx.runId),
    ).toMatchObject({ branch_id: fx.branchId, action_id: fx.journalActionId, finished: 1 })
  })

  it('copies every row onto the new branch with only branch_id changed', async () => {
    const t = await createTestDb()
    const fx = await seedCopyFixture(t)
    const before = branchSnapshot(t.sqlite, fx.branchId)

    cloneBranch(t.sqlite, fx.branchId, 'br_b')

    expect(branchSnapshot(t.sqlite, 'br_b')).toEqual(flipped(before, 'br_b'))
    expect(branchSnapshot(t.sqlite, fx.branchId)).toEqual(before)
    expect(
      t.sqlite.prepare('SELECT story_id, parent_branch_id FROM branches WHERE id = ?').get('br_b'),
    ).toMatchObject({ story_id: fx.storyId, parent_branch_id: fx.branchId })
    expect(
      t.sqlite.prepare('SELECT count(*) AS n FROM pipeline_runs WHERE branch_id = ?').get('br_b'),
    ).toMatchObject({ n: 0 })
  })

  it('leaves a copied delete payload naming the branch it was copied from', async () => {
    const t = await createTestDb()
    const fx = await seedCopyFixture(t)

    cloneBranch(t.sqlite, fx.branchId, 'br_b')

    const row = t.sqlite
      .prepare(
        "SELECT undo_payload FROM deltas WHERE branch_id = ? AND action_id = ? AND op = 'delete'",
      )
      .get('br_b', fx.deleteActionId) as { undo_payload: string }
    const payload = JSON.parse(row.undo_payload) as {
      id: string
      branchId: string
      relationships: { branchId: string }[]
      awareness: { branchId: string }[]
    }
    expect(payload).toMatchObject({ id: fx.deletedCharacterId, branchId: fx.branchId })
    expect(payload.relationships).toHaveLength(1)
    expect(payload.awareness).toHaveLength(1)
    expect([...payload.relationships, ...payload.awareness].map((child) => child.branchId)).toEqual(
      [fx.branchId, fx.branchId],
    )
  })

  it('refuses a source branch with no row', async () => {
    const t = await createTestDb()

    expect(() => cloneBranch(t.sqlite, 'br_none', 'br_b')).toThrow('cloneBranch: no branch br_none')
  })
})
