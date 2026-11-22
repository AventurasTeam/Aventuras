import { describe, expect, it } from 'vitest'

import { branchCopyOps } from '@/lib/db'

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

  // data-model.md → Branch model: captures copy in neither mode. br_c is st_2's, as a duplicate's is.
  it('copies no capture into a duplicate and leaves the source both of its own', async () => {
    const { db, sqlite, runInTransaction } = await seededDb()
    for (const id of ['pc_1', 'pc_2'])
      await writeProbeCapture({ runInTransaction }, captureInput({ id, branchId: 'br_a' }))

    await runInTransaction(branchCopyOps(db, { from: 'br_a', to: 'br_c', mode: 'duplicate' }))

    const count = (branchId: string) =>
      sqlite.prepare('SELECT count(*) AS n FROM probe_captures WHERE branch_id = ?').get(branchId)
    expect(count('br_c')).toMatchObject({ n: 0 })
    expect(count('br_a')).toMatchObject({ n: 2 })
  })
})
