import { describe, expect, it } from 'vitest'

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
})
