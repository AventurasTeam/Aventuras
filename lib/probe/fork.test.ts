import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { captureInput, seededDb } from './__tests__/fixtures'
import { writeProbeCapture } from './writer'

// No fork/branch-copy helper exists anywhere in the codebase (grepped
// lib/actions/stories and lib/ as a whole) — M6.1 branch-fork orchestration
// is unimplemented, and data-model.md's "Branch-copy manifest" is a prose
// table, not code. The AC's structural fallback becomes: nothing outside
// probe's own module, and the five files already audited below for
// schema/type/delete-cascade reasons, references probe_captures at all — so
// no copy path exists today that a captures exclusion would need to defend
// against. This is a structural stand-in for the behavioral "fork it and
// check both sides" test the slice AC asks for; it is not a test of fork
// itself, because fork does not exist yet.
const TABLE_REF = /\bprobe_captures\b|\bprobeCaptures\b/

const AUDITED_REFERRERS = new Set([
  'lib/db/index.ts',
  'lib/db/schema.ts',
  'lib/db/types.ts',
  'lib/db/system/system.table.ts',
  'lib/actions/stories/delete-story.ts',
])

export function findUnauditedReferences(files: { path: string; src: string }[]): string[] {
  return files.filter((f) => TABLE_REF.test(f.src)).map((f) => f.path)
}

describe('fork', () => {
  it('detects a planted branch-copy reference (detector is not vacuous)', () => {
    const planted = [
      { path: 'lib/actions/stories/fork-branch.ts', src: 'db.insert(probeCaptures).select(...)' },
    ]

    expect(findUnauditedReferences(planted)).toEqual(['lib/actions/stories/fork-branch.ts'])
  })

  it('no unaudited code anywhere in lib/ references probe_captures', async () => {
    const paths = await fg(['lib/**/*.ts'], {
      ignore: ['**/node_modules/**', 'lib/probe/**', '**/*.test.ts'],
      cwd: process.cwd(),
    })
    const files = paths
      .filter((path) => !AUDITED_REFERRERS.has(path))
      .map((path) => ({ path, src: readFileSync(path, 'utf8') }))

    expect(findUnauditedReferences(files)).toEqual([])
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
