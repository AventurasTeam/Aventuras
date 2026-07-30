import { describe, expect, it } from 'vitest'

import { renderTemplate, TEMPLATE_IDS } from '..'

const context = {
  turns: [
    { handle: 't1', content: 'Kael falls at the ford, lifeless.' },
    { handle: 't2', content: 'Aria hears of it from Jorin.' },
  ],
  entities: [
    { id: 'c1', name: 'Kael', kind: 'character', status: 'active', description: 'A courier.' },
    { id: 'c2', name: 'Aria', kind: 'character', status: 'staged', description: 'His sister.' },
  ],
  happenings: [{ id: 'hp1', title: 'The satchel was stolen' }],
  lore: [],
  definition: { setting: '', genre: { promptBody: '' }, tone: { promptBody: '' } },
  calendarVocabulary: null,
}

describe('periodic classifier template', () => {
  it('carries the hard-finality retirement directive', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toMatchSnapshot()
    expect(rendered).toMatch(/only on unambiguous/i)
    expect(rendered).toMatch(/wandered off/i)
  })

  it('labels every window turn with its provenance handle', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toContain('[t1]')
    expect(rendered).toContain('[t2]')
  })

  // The cross-turn attribution rule is a PROMPT obligation, not planner logic:
  // the schema carries one sourceTurn per fact, so nothing downstream can
  // enforce "latest contributing turn". This assertion is its only guard.
  it('instructs latest-contributing-turn attribution for cross-turn synthesis', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toMatch(/latest contributing turn/i)
  })

  it('instructs one-perspective-only relationship emission', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toMatch(/do not infer the inverse/i)
  })

  it('exposes the placeholder universe including happenings', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toContain('[c1]')
    expect(rendered).toContain('[hp1]')
  })

  it('renders (none) for an empty entity and happening universe', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, {
      ...context,
      entities: [],
      happenings: [],
    })
    expect(rendered).toContain('(none)')
  })
})
