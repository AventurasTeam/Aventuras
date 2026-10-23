import { describe, expect, it } from 'vitest'

import { templateGlobals } from '../engine'
import {
  bundledPack,
  renderTemplate,
  TEMPLATE_GROUPS,
  TEMPLATE_IDS,
  templateReads,
  VARIABLES,
} from '../index'
import { loadPack } from '../load-pack'
import { validatePackIncludes } from '../validate-includes'

describe('bundled pack', () => {
  it('passes include-compatibility validation', () => {
    expect(validatePackIncludes(bundledPack)).toEqual([])
  })

  // A read the registry doesn't define is a variable no builder emits: an include site that leaves
  // out one of a macro's arguments reads it as one (macro_entity_state's ids, here).
  it.each(Object.values(TEMPLATE_IDS).filter((id) => TEMPLATE_GROUPS[id] === 'generationContext'))(
    '%s reads only variables the registry defines',
    (templateId) => {
      const defined = new Set(VARIABLES.generationContext.map((v) => v.name))
      expect([...templateReads(templateId)].filter((name) => !defined.has(name))).toEqual([])
    },
  )

  it('loads without throwing (engine builds)', () => {
    expect(() => loadPack(bundledPack)).not.toThrow()
  })

  // architecture.md → System and user halves: a wizard template's system half is empty.
  it('leaves every wizard template system half empty', () => {
    const wizard = Object.entries(bundledPack.templates).filter(([, t]) => t.group === 'wizard')
    expect(wizard).toHaveLength(13)
    expect(wizard.filter(([, t]) => t.system !== '').map(([id]) => id)).toEqual([])
  })

  // The context builder skips the query behind an unread variable, so a system-half-only read
  // left out of templateReads would render empty.
  it('reports the variables a template reads in its system half', () => {
    const { engine } = loadPack(bundledPack)
    const id = TEMPLATE_IDS.perTurnNarrative
    expect(templateGlobals(engine, id, 'user')).not.toContain('calendarVocabulary')
    expect(templateReads(id)).toContain('calendarVocabulary')
  })

  it('renders the wizard opening from definition + lead', () => {
    const out = renderTemplate(TEMPLATE_IDS.wizardOpening, {
      definition: {
        mode: 'adventure',
        setting: 'A frozen coast.',
        genre: { promptBody: '' },
        tone: { promptBody: '' },
      },
      leadEntityId: 'c1',
      cast: [{ id: 'c1', kind: 'character', name: 'Aria', description: '', status: 'active' }],
    }).user
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

    const classifier = renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context).user
    // suggestionsFire: false is what the refresh phase actually produces — it
    // never sets the flag, so buildGenerationContext defaults it. Rendering
    // this half with `true` would let a suggestionsFire guard be added to the
    // refresh template and still pass, while shipping a prompt with no chip
    // section at all.
    const refresh = renderTemplate(TEMPLATE_IDS.suggestionRefresh, {
      ...context,
      suggestionsFire: false,
    }).user

    expect(instruction(classifier)).toBe(instruction(refresh))
    expect(instruction(refresh)).toContain('exactly 2 distinct entries')
    expect(instruction(refresh)).toContain('id "cat1" = Action — use it for: act')
    // The tagged-block macro is the OTHER contract; it must not leak in here.
    expect(classifier + refresh).not.toContain('<suggestions>')
  })

  it('asks the fallback classifier for the one-sentence summary Q3 retrieval needs', () => {
    const context = {
      entities: [],
      lastTurns: [{ content: 'The gate groaned open.' }],
    }
    const classifier = renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context).user

    expect(classifier).toMatch(/one[- ]sentence summary/i)
  })

  it('asks the fallback classifier for the retrieval queries Q4 needs', () => {
    const context = { entities: [], lastTurns: [{ content: 'The gate groaned open.' }] }
    const classifier = renderTemplate(TEMPLATE_IDS.piggybackFallbackClassifier, context).user

    expect(classifier).toMatch(/up to three/i)
    expect(classifier).toMatch(/next turn/i)
  })
})
