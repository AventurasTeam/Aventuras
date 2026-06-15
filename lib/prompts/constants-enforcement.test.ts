import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

import { MACRO_IDS, TEMPLATE_IDS } from './ids'

const IDS = [...Object.values(TEMPLATE_IDS), ...Object.values(MACRO_IDS)]

// Pure detector — also unit-tested below so the scan can't pass vacuously.
export function findInlinedIds(files: { path: string; src: string }[], ids: string[]): string[] {
  const offenders: string[] = []
  for (const { path, src } of files) {
    for (const id of ids) {
      if (src.includes(`'${id}'`) || src.includes(`"${id}"`)) offenders.push(`${path}: ${id}`)
    }
  }
  return offenders
}

describe('template/macro ids are referenced via constants, not inlined', () => {
  it('detects a planted inline id (detector is not vacuous)', () => {
    const planted = [
      { path: 'components/x.tsx', src: `renderTemplate('${TEMPLATE_IDS.perTurnNarrative}', {})` },
    ]
    expect(findInlinedIds(planted, IDS)).toHaveLength(1)
  })

  it('no consumer module inlines a template or macro id literal', async () => {
    // lib/prompts owns the literals; everything else must use the constants.
    const paths = await fg(['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'], {
      ignore: ['**/node_modules/**', 'lib/prompts/**'],
      cwd: process.cwd(),
    })
    const files = paths.map((path) => ({ path, src: readFileSync(path, 'utf8') }))
    expect(findInlinedIds(files, IDS)).toEqual([])
  })
})
