import { describe, expect, it } from 'vitest'

import { bundledPack, renderTemplate, TEMPLATE_IDS } from '../index'
import { loadPack } from '../load-pack'
import { validatePackIncludes } from '../validate-includes'

describe('bundled pack', () => {
  it('passes include-compatibility validation', () => {
    expect(validatePackIncludes(bundledPack)).toEqual([])
  })

  it('loads without throwing (engine builds)', () => {
    expect(() => loadPack(bundledPack)).not.toThrow()
  })

  it('renders the wizard opening from definition + lead', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: {
        mode: 'adventure',
        setting: 'A frozen coast.',
        genre: { promptBody: '' },
        tone: { promptBody: '' },
      },
      leadName: 'Aria',
      leadEntityId: 'c1',
    })
    expect(out).toContain('adventure')
    expect(out).toContain('A frozen coast.')
    expect(out).toContain('Aria')
    expect(out).toContain('cast id: c1')
    expect(out).toContain('Respond with a single JSON object') // included output-format macro
    expect(out).toMatchSnapshot()
  })
})
