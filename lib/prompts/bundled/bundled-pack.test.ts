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
    expect(out).toMatchSnapshot()
  })

  // Both structured surfaces include macro_suggestion_emission_json; editing the
  // chip contract inline in one template instead of the macro diverges them here.
  it('renders one identical JSON chip instruction on both structured surfaces', () => {
    const context = {
      definition: { mode: 'adventure', genre: { promptBody: '' }, tone: { promptBody: '' } },
      entities: [],
      entries: [{ content: 'The gate groaned open.' }],
      suggestionsFire: true,
      suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'act' }],
      suggestionCount: 2,
    }
    const instruction = (prompt: string) => {
      const start = prompt.indexOf('Populate the "suggestions" field')
      const end = prompt.indexOf('one or two sentences.')
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      return prompt.slice(start, end)
    }

    const classifier = renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context)
    const refresh = renderTemplate(TEMPLATE_IDS.suggestionRefresh, context)

    expect(instruction(classifier)).toBe(instruction(refresh))
    expect(instruction(refresh)).toContain('exactly 2 distinct entries')
    expect(instruction(refresh)).toContain('id "cat1" = Action — use it for: act')
    // The tagged-block macro is the OTHER contract; it must not leak in here.
    expect(classifier + refresh).not.toContain('<suggestions>')
  })
})
