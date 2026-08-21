import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

// patches/js-tiktoken.patch replaces the object-literal accumulator in
// _Tiktoken's bpe_ranks decode with Map staging, and switches the consuming
// loop off Object.entries to match. Hermes caps properties-per-object below
// o200k_base's ~200k entries, so the unpatched form throws RangeError on
// Android at `new Tiktoken(o200kBase)` — every countTokens consumer. Node has
// no such cap, CI has no Android lane, and this repo's patch keys are
// version-less, which makes pnpm warn rather than fail when a patch stops
// applying: the shape of the installed dist is the only automatable signal.
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

// Both stable cjs entry points plus the hash-named ESM chunk. The names are
// deliberately not pinned — the chunk's is a build hash — so the count is what
// catches a bundle silently leaving the scan.
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
    // No filename is pinned: the ESM chunk the app runs through is hash-named
    // (dist/chunk-*.js today) and a version bump renames it, while Metro may
    // resolve the cjs entry on Android. Whatever files define the decode are
    // the ones that must carry the patch.
    const paths = await fg(['node_modules/js-tiktoken/dist/**/*.{js,cjs,mjs}'], {
      cwd: process.cwd(),
    })
    const files = paths.map((path) => ({ path, src: readFileSync(path, 'utf8') }))
    const audit = auditRanksDecode(files)

    // Shrinkage is the dangerous direction: a bundle that leaves the glob or
    // renames the decode drops out silently and every other assertion still
    // holds. Re-derive patches/js-tiktoken.patch if this moves.
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
