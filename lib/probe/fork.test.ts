import { describe, expect, it } from 'vitest'

import { forkBranchCore } from '@/lib/actions'
import { branchCopyOps, storyEntries } from '@/lib/db'

import { captureInput, seededDb } from './__tests__/fixtures'
import { writeProbeCapture } from './writer'

describe('captures do not cross branches', () => {
  it('keeps captures strictly branch_id-scoped in storage — the invariant a fork exclusion depends on', async () => {
    const { sqlite, runInTransaction } = await seededDb()

    for (const id of ['pc_1', 'pc_2'])
      await writeProbeCapture({ runInTransaction }, captureInput({ id, branchId: 'br_a' }))

    const onSource = sqlite
      .prepare('SELECT count(*) AS n FROM probe_captures WHERE branch_id = ?')
      .get('br_a')
    const onSiblingBranch = sqlite
      .prepare('SELECT count(*) AS n FROM probe_captures WHERE branch_id = ?')
      .get('br_b')

    // Both sides asserted: a query that matched nothing at all would satisfy
    // the second expectation alone.
    expect(onSource).toMatchObject({ n: 2 })
    expect(onSiblingBranch).toMatchObject({ n: 0 })
  })

  // data-model.md → Branch model: no mode copies captures. br_c is st_2's, as a duplicate's is.
  it('copies no capture into a duplicate and leaves the source both of its own', async () => {
    const { db, sqlite, runInTransaction } = await seededDb()
    for (const id of ['pc_1', 'pc_2'])
      await writeProbeCapture({ runInTransaction }, captureInput({ id, branchId: 'br_a' }))

    await runInTransaction(await branchCopyOps(db, { from: 'br_a', to: 'br_c', mode: 'duplicate' }))

    const count = (branchId: string) =>
      sqlite.prepare('SELECT count(*) AS n FROM probe_captures WHERE branch_id = ?').get(branchId)
    expect(count('br_c')).toMatchObject({ n: 0 })
    expect(count('br_a')).toMatchObject({ n: 2 })
  })

  // data-model.md → Branch model: a fork copies no capture (probe.md → Branch fork and capture
  // portability). br_a's opening is the narrative tail, so the plan is empty and the copy is whole.
  it('leaves every capture on the parent when forkBranchCore forks it (AC 19)', async () => {
    const { db, sqlite, runInTransaction } = await seededDb()
    await db.insert(storyEntries).values({
      id: 'ent_open',
      branchId: 'br_a',
      position: 1,
      kind: 'opening',
      content: 'The tide came in early.',
      createdAt: 1000,
    })
    for (const id of ['pc_1', 'pc_2'])
      await writeProbeCapture(
        { runInTransaction },
        captureInput({ id, branchId: 'br_a', targetEntryId: 'ent_open' }),
      )

    const forked = await forkBranchCore(
      {
        parentBranchId: 'br_a',
        forkEntryId: 'ent_open',
        name: 'Low tide',
        makeCurrent: false,
        newBranchId: 'br_fork',
        createdAt: 2000,
      },
      { db, runInTransaction },
    )

    expect(forked).toEqual({ status: 'ok', branchId: 'br_fork' })
    const count = (branchId: string) =>
      sqlite.prepare('SELECT count(*) AS n FROM probe_captures WHERE branch_id = ?').get(branchId)
    expect(count('br_fork')).toMatchObject({ n: 0 })
    expect(count('br_a')).toMatchObject({ n: 2 })
    // Not vacuous: the copy ran, so the child holds the parent's entry.
    const copied = sqlite
      .prepare('SELECT id FROM story_entries WHERE branch_id = ?')
      .all('br_fork') as { id: string }[]
    expect(copied.map((row) => row.id)).toEqual(['ent_open'])
  })
})
