import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

// patches/js-tiktoken.patch replaces the object-literal accumulator in
// _Tiktoken's bpe_ranks decode with Map staging. Hermes caps the number of
// properties on one object below o200k_base's ~200k entries, so the unpatched
// form throws RangeError on Android at `new Tiktoken(o200kBase)` — in the
// reader and in story settings (every countTokens consumer). Node has no such
// cap and CI has no Android lane, so the only automatable signal is the shape
// of the installed dist itself.
const OBJECT_FORM = /tokens\.forEach\(\(token, i\) => memo\[token\] = offset \+ i\)/
const MAP_FORM = /tokens\.forEach\(\(token, i\) => memo\.set\(token, offset \+ i\)\)/
const DECODE_SITE = /ranks\.bpe_ranks\.split\("\\n"\)/

export function auditRanksDecode(files: { path: string; src: string }[]): {
  decodeSites: string[]
  mapStaged: string[]
  objectStaged: string[]
} {
  const decodeSites: string[] = []
  const mapStaged: string[] = []
  const objectStaged: string[] = []
  for (const { path, src } of files) {
    if (!DECODE_SITE.test(src)) continue
    decodeSites.push(path)
    if (MAP_FORM.test(src)) mapStaged.push(path)
    if (OBJECT_FORM.test(src)) objectStaged.push(path)
  }
  return { decodeSites, mapStaged, objectStaged }
}

const UNPATCHED = `
    const uncompressed = ranks.bpe_ranks.split("\\n").filter(Boolean).reduce((memo, x) => {
      const [_, offsetStr, ...tokens] = x.split(" ");
      const offset = Number.parseInt(offsetStr, 10);
      tokens.forEach((token, i) => memo[token] = offset + i);
      return memo;
    }, {});
`

const PATCHED = `
    const uncompressed = ranks.bpe_ranks.split("\\n").filter(Boolean).reduce((memo, x) => {
      const [_, offsetStr, ...tokens] = x.split(" ");
      const offset = Number.parseInt(offsetStr, 10);
      tokens.forEach((token, i) => memo.set(token, offset + i));
      return memo;
    }, new Map());
`

describe('js-tiktoken patch guard', () => {
  it('tells the unpatched decode from the patched one (detector is not vacuous)', () => {
    const audit = auditRanksDecode([
      { path: 'dist/a.js', src: UNPATCHED },
      { path: 'dist/b.cjs', src: PATCHED },
    ])
    expect(audit.decodeSites).toEqual(['dist/a.js', 'dist/b.cjs'])
    expect(audit.objectStaged).toEqual(['dist/a.js'])
    expect(audit.mapStaged).toEqual(['dist/b.cjs'])
  })

  it('every installed dist bundle stages the ranks through a Map, none through an object', async () => {
    // No filename is pinned: the ESM chunk the app runs through is hash-named
    // (dist/chunk-*.js today) and a version bump renames it, while Metro may
    // resolve the cjs entry on Android. Whatever files define the decode are
    // the ones that must carry the patch.
    const paths = await fg(['node_modules/js-tiktoken/dist/**/*.{js,cjs}'], {
      cwd: process.cwd(),
    })
    const files = paths.map((path) => ({ path, src: readFileSync(path, 'utf8') }))
    const audit = auditRanksDecode(files)

    expect(audit.decodeSites.length, 'dist bundles that build the rank table').toBeGreaterThan(0)
    expect(audit.objectStaged).toEqual([])
    expect(audit.mapStaged.sort()).toEqual(audit.decodeSites.sort())
  })
})
