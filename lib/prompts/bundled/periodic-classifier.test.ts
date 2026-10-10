import { describe, expect, it } from 'vitest'

import { NEW_HANDLE_PREFIX } from '@/lib/classifier'

import { renderTemplate, TEMPLATE_IDS } from '..'

const context = {
  turns: [
    { handle: 't1', content: 'Kael falls at the ford, lifeless.', scene: ['c1'], location: 'l1' },
    { handle: 't2', content: 'Aria hears of it from Jorin.', scene: [], location: null },
  ],
  entities: [
    {
      id: 'c1',
      name: 'Kael',
      kind: 'character',
      status: 'active',
      description: 'A courier.',
      keywords: ['the Grey Wolf', 'the courier'],
    },
    {
      id: 'c2',
      name: 'Aria',
      kind: 'character',
      status: 'staged',
      description: 'His sister.',
      keywords: [],
    },
    {
      id: 'l1',
      name: 'The ford',
      kind: 'location',
      status: 'active',
      description: null,
      keywords: [],
    },
  ],
  happenings: [{ id: 'hp1', title: 'The satchel was stolen' }],
  relationships: [
    { subject: 'c1', subjectName: 'Kael', object: 'c2', objectName: 'Aria', kind: 'sister' },
  ],
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

  // The reserved namespace is what keeps a newCharacters handle out of the
  // placeholder space; substituteClassifierIds defends the case anyway, but an
  // unprefixed instruction invites the collision on every reply.
  it('reserves the new: namespace for newCharacters handles', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toContain(NEW_HANDLE_PREFIX)
    expect(rendered).toMatch(/MUST start with/i)
  })

  // A schema field the prompt never asks for is a field the model never fills.
  it('asks for the epithets a new character is named by', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toMatch(/keywords/i)
    expect(rendered).toMatch(/epithets/i)
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
      relationships: [],
    })
    expect(rendered).toContain('(none)')
  })

  it('renders a stored relationship view as a subject-sees-object line', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toContain('- [c1] Kael sees [c2] Aria as: sister')
  })

  // classifier.md → What the classifier reads: the saved scene rides each turn.
  it("shows a turn's saved scene and location after its handle, prose on the next line", () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toContain(
      '[t1] scene: [c1]; location: [l1]\nKael falls at the ford, lifeless.',
    )
    expect(rendered).toContain('\n[t2]\nAria hears of it from Jorin.')
    expect(rendered).toContain('scene and location, by the same ID rule, may follow the handle')
  })

  it('renders a scene without a location, and a location without a scene', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, {
      ...context,
      turns: [
        { handle: 't1', content: 'Both are here.', scene: ['c1', 'c2'], location: null },
        { handle: 't2', content: 'At the ford.', scene: [], location: 'l1' },
      ],
    })
    expect(rendered).toContain('[t1] scene: [c1], [c2]\nBoth are here.')
    expect(rendered).toContain('[t2] location: [l1]\nAt the ford.')
  })

  it("lists an entity's stored keywords on its line, and nothing when it has none", () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toContain(
      '- [c1] Kael (character) — A courier. (also called: the Grey Wolf, the courier)\n',
    )
    expect(rendered).toContain('- [c2] Aria (character, staged) — His sister.\n')
  })

  it('tells the model that prose naming an entity in its turn scene or location refers to it', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toMatch(
      /Prose naming an entity in its turn's scene, or its location, refers to that entity/,
    )
  })

  // classifier.md → What the classifier reads: a name form of a listed character takes its ID.
  it('steers a name form of a listed character to its ID and the alias list', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toMatch(
      /A shortened or fuller name, a title or an alias of a listed character is that character unless the prose shows it is someone else/,
    )
    expect(rendered).toMatch(/put the new name form in aliases/)
  })

  // A schema field the prompt never asks for is a field the model never fills.
  it('asks for an aliases entry for a listed entity of any kind', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.periodicClassifier, context)
    expect(rendered).toMatch(/- Aliases\. When the prose calls a listed entity of any kind/)
    expect(rendered).toMatch(/Leave out forms its line already shows/)
  })
})
