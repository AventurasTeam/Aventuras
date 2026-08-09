import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { captureInput, seededDb } from './__tests__/fixtures'
import { writeProbeCapture } from './writer'

const TABLE_REF = /\bprobe_captures\b|\bprobeCaptures\b/

const AUDITED_REFERRERS = new Set([
  'lib/db/index.ts',
  'lib/db/schema.ts',
  'lib/db/types.ts',
  'lib/db/system/system.table.ts',
  'lib/actions/stories/delete-story.ts',
])

export function findTableReferences(files: { path: string; src: string }[]): string[] {
  return files.filter((f) => TABLE_REF.test(f.src)).map((f) => f.path)
}

// No fork/branch-copy code exists in lib/ to call directly, so these tests
// defend the invariant structurally: nothing outside probe's own module
// names probe_captures, and storage stays strictly branch_id-scoped.
describe('captures do not cross branches', () => {
  it('detects a planted branch-copy reference (detector is not vacuous)', () => {
    const planted = [
      { path: 'lib/actions/stories/fork-branch.ts', src: 'db.insert(probeCaptures).select(...)' },
    ]

    expect(findTableReferences(planted)).toEqual(['lib/actions/stories/fork-branch.ts'])
  })

  it('no unaudited code anywhere in lib/ references probe_captures', async () => {
    const paths = await fg(['lib/**/*.{ts,tsx}'], {
      ignore: ['**/node_modules/**', 'lib/probe/**', '**/*.test.{ts,tsx}'],
      cwd: process.cwd(),
    })
    // Guards the scan itself, not just the detector: a wrong cwd or a glob
    // typo would otherwise leave every audited referrer silently unmatched.
    expect(paths).toEqual(expect.arrayContaining([...AUDITED_REFERRERS]))

    const files = paths
      .filter((path) => !AUDITED_REFERRERS.has(path))
      .map((path) => ({ path, src: readFileSync(path, 'utf8') }))

    expect(findTableReferences(files)).toEqual([])
  })

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
