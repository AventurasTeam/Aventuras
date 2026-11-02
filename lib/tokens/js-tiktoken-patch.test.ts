import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

// patches/js-tiktoken.patch swaps the object-literal bpe_ranks accumulator for Map staging:
// Hermes caps properties-per-object below o200k_base's ~200k entries, throwing RangeError on
// Android at every countTokens call — Node has no such cap, CI has no Android lane.
// `ignorePatchFailures: false` fails a patch that no longer applies, but not one regenerated
// without the hunk, so the installed dist's shape is the only signal for that.
const OBJECT_FORM = /tokens\.forEach\(\(token, i\) => memo\[token\] = offset \+ i\)/
const MAP_FORM = /tokens\.forEach\(\(token, i\) => memo\.set\(token, offset \+ i\)\)/
// The other half of the same hunk. Map staging without it degrades to an empty
// rank table — wrong counts everywhere, and no throw to notice it by.
const CONSUME_FORM = /for \(const \[token, rank\] of uncompressed\)/
const DECODE_SITE = /ranks\.bpe_ranks\.split\("\\n"\)/

export function auditRanksDecode(files: { path: string; src: string }[]): {
  decodeSites: string[]
  mapStaged: string[]
  objectStaged: string[]
  mapConsumed: string[]
} {
  const decodeSites: string[] = []
  const mapStaged: string[] = []
  const objectStaged: string[] = []
  const mapConsumed: string[] = []
  for (const { path, src } of files) {
    if (!DECODE_SITE.test(src)) continue
    decodeSites.push(path)
    if (MAP_FORM.test(src)) mapStaged.push(path)
    if (OBJECT_FORM.test(src)) objectStaged.push(path)
    if (CONSUME_FORM.test(src)) mapConsumed.push(path)
  }
  return { decodeSites, mapStaged, objectStaged, mapConsumed }
}

const UNPATCHED = `
    const uncompressed = ranks.bpe_ranks.split("\\n").filter(Boolean).reduce((memo, x) => {
      const [_, offsetStr, ...tokens] = x.split(" ");
      const offset = Number.parseInt(offsetStr, 10);
      tokens.forEach((token, i) => memo[token] = offset + i);
      return memo;
    }, {});
    for (const [token, rank] of Object.entries(uncompressed)) {
`

const PATCHED = `
    const uncompressed = ranks.bpe_ranks.split("\\n").filter(Boolean).reduce((memo, x) => {
      const [_, offsetStr, ...tokens] = x.split(" ");
      const offset = Number.parseInt(offsetStr, 10);
      tokens.forEach((token, i) => memo.set(token, offset + i));
      return memo;
    }, new Map());
    for (const [token, rank] of uncompressed) {
`

// Counts both stable cjs entry points plus the hash-named ESM chunk (its name isn't pinned —
// it's a build hash); the count is what catches a bundle silently leaving the scan.
const KNOWN_DECODE_SITES = 3

describe('js-tiktoken patch guard', () => {
  it('tells the unpatched decode from the patched one (detector is not vacuous)', () => {
    const audit = auditRanksDecode([
      { path: 'dist/a.js', src: UNPATCHED },
      { path: 'dist/b.cjs', src: PATCHED },
    ])
    expect(audit.decodeSites).toEqual(['dist/a.js', 'dist/b.cjs'])
    expect(audit.objectStaged).toEqual(['dist/a.js'])
    expect(audit.mapStaged).toEqual(['dist/b.cjs'])
    expect(audit.mapConsumed).toEqual(['dist/b.cjs'])
  })

  it('every installed dist bundle stages the ranks through a Map, none through an object', async () => {
    // No filename pinned: the ESM chunk is hash-named (renamed on version bumps), and Metro
    // may resolve the cjs entry on Android instead — whichever file defines the decode must
    // carry the patch.
    const paths = await fg(['node_modules/js-tiktoken/dist/**/*.{js,cjs,mjs}'], {
      cwd: process.cwd(),
    })
    const files = paths.map((path) => ({ path, src: readFileSync(path, 'utf8') }))
    const audit = auditRanksDecode(files)

    // Shrinkage is the dangerous direction — a bundle leaving the glob or renaming the decode
    // drops out silently with every other assertion still passing. Re-derive the patch if this
    // moves.
    expect(
      audit.decodeSites.length,
      'dist bundles that build the rank table — re-derive patches/js-tiktoken.patch if this changed',
    ).toBeGreaterThanOrEqual(KNOWN_DECODE_SITES)
    expect(
      audit.objectStaged,
      'bundles still staging ranks on an object — Hermes throws RangeError on these',
    ).toEqual([])
    expect([...audit.mapStaged].sort(), 'bundles staging ranks through a Map').toEqual(
      [...audit.decodeSites].sort(),
    )
    expect(
      [...audit.mapConsumed].sort(),
      'bundles reading the staged Map directly — Object.entries on a Map yields an empty rank table',
    ).toEqual([...audit.decodeSites].sort())
  })
})
