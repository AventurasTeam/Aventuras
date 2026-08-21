import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const RENDERER_COPY = 'types/embedder-bridge.d.ts'
const MAIN_COPY = 'electron/embedder/types.ts'

// The contract is written twice because electron/tsconfig.json is a separate
// compile unit (rootDir electron/, no path aliases): main cannot import types/.
describe('embedder bridge contract', () => {
  it('keeps the main-process copy verbatim inside the renderer copy', () => {
    const renderer = readFileSync(RENDERER_COPY, 'utf8')
    const main = readFileSync(MAIN_COPY, 'utf8').trim()

    // Containment, not equality: the renderer copy adds a header note and the
    // `declare global` Window augmentation. Shared types must match verbatim.
    expect(renderer).toContain(main)
  })

  it('reads two files that actually exist and carry the contract', () => {
    // Guards the guard: a moved file would make the containment check vacuous.
    const main = readFileSync(MAIN_COPY, 'utf8')
    expect(main).toContain('EmbedderErrorEnvelope')
    expect(main).toContain('cancelEmbed')
    expect(main.length).toBeGreaterThan(500)
  })
})
