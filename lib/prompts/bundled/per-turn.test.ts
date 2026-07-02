import { describe, expect, it } from 'vitest'

import { renderTemplate, TEMPLATE_IDS } from '../index'

// M2-shaped context: opening + a couple of entries, one entity, empty genre /
// tone / setting (M2 stories carry these empty until M3.6).
const m2Context = {
  definition: {
    mode: 'adventure',
    genre: { promptBody: '' },
    tone: { promptBody: '' },
    setting: '',
  },
  entities: [
    {
      id: 'char_1',
      kind: 'character',
      name: 'Aria',
      description: 'A wary scout.',
      status: 'active',
      injectionMode: 'auto',
    },
  ],
  sceneEntities: ['char_1'],
  entries: [{ content: 'The gate groaned open.' }, { content: 'Aria stepped through.' }],
}

describe('bundled per-turn template — empty-guard contract', () => {
  const out = renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context)

  it('emits no dangling section headers for empty genre/tone/setting', () => {
    expect(out).not.toContain('# Setting')
    expect(out).not.toContain('# Genre')
    expect(out).not.toContain('# Tone')
  })

  it('still renders the in-scene character and the entry buffer', () => {
    expect(out).toContain('# Characters in scene')
    expect(out).toContain('## Aria')
    expect(out).toContain('The gate groaned open.')
    expect(out).toContain('Aria stepped through.')
  })

  it('matches the recorded snapshot', () => {
    expect(out).toMatchSnapshot()
  })
})
