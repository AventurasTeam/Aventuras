import { rmSync } from 'node:fs'
import { type DatabaseSync } from 'node:sqlite'

import { describe, it } from 'vitest'

import { runRetrieval } from '@/lib/retrieval'

import { build, median, passInputs, SCALES, type Fixture, type Scale } from './fixture'

/**
 * Prices one retrieval pass against the volumes retrieval.md → Scale assumptions
 * projects, so the cost budget there can be re-derived from measurement rather
 * than re-estimated. Asserts nothing: it reports.
 *
 * Excluded from the measurement, deliberately: the embedder (its cost is a
 * provider property, not the pass's) and IPC (the desktop bridge sits outside
 * lib/retrieval). Everything else the pass does is inside these numbers.
 *
 * `boost=off` runs the same fixture with the chapter budget zeroed, which seats
 * no chapter and so switches the chapter-range admission path off — the
 * difference between the two rows is what retrieval.md → Chapter-match boost
 * costs. What it BUYS cannot be shown here: which rows the boost rescues needs a
 * real story's happening distribution, not a synthetic one.
 */
describe('retrieval cost', () => {
  for (const dim of [384, 768]) {
    for (const scale of SCALES) {
      for (const chapterBudget of ['on', 'off'] as const) {
        it(`dim ${dim} — ${scale.label} — boost ${chapterBudget}`, async () => {
          // A pass that throws mid-run must still drop its handle and temp dir:
          // the run is 12 fixtures, each a file-backed db under tmpdir.
          let sqlite: DatabaseSync | undefined
          let dir: string | undefined
          try {
            const fixture = build(scale, dim)
            sqlite = fixture.sqlite
            dir = fixture.dir
            await measure(fixture, dim, scale, chapterBudget)
          } finally {
            try {
              sqlite?.close()
            } finally {
              if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
            }
          }
        }, 300_000)
      }
    }
  }
})

async function measure(
  fixture: Fixture,
  dim: number,
  scale: Scale,
  chapterBudget: 'on' | 'off',
): Promise<void> {
  const { deps, params } = passInputs(fixture, dim, chapterBudget)

  const samples: Record<string, number>[] = []
  let funnels = ''
  for (let i = 0; i < 9; i += 1) {
    const out = await runRetrieval(deps as never, params)
    if (!out.ok) throw new Error(`pass failed: ${out.cancelled ? 'cancelled' : out.failure.detail}`)
    if (i >= 2) samples.push(out.timings as unknown as Record<string, number>)
    funnels = Object.entries(out.bundles)
      .map(([t, b]) => `${t}:${b.funnel.poolSize}/${b.funnel.selectedCount}`)
      .join(' ')
  }
  const keys = ['totalMs', 'syncMs', 'embedMs', 'knnMs', 'rankMs']
  const line = keys
    .map((k) => `${k.replace('Ms', '')}=${median(samples.map((s) => s[k]!)).toFixed(1)}`)
    .join('  ')
  process.stdout.write(
    `  dim=${dim} ${scale.label.padEnd(16)} boost=${chapterBudget.padEnd(3)} ${line}\n` +
      `    pools ${funnels}\n`,
  )
}
