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
  userSettings: { partialChapterBuffer: 10 },
  piggybackFires: true,
}

describe('bundled per-turn template — empty-guard contract', () => {
  const out = renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context)

  it('emits no dangling section headers for empty genre/tone/setting', () => {
    expect(out).not.toContain('# Setting')
    expect(out).not.toContain('# Genre')
    expect(out).not.toContain('# Tone')
  })

  it('still renders the in-scene character and the entry buffer', () => {
    expect(out).toContain('# In scene')
    expect(out).toContain('## Aria [char_1]')
    expect(out).toContain('The gate groaned open.')
    expect(out).toContain('Aria stepped through.')
  })

  it('matches the recorded snapshot', () => {
    expect(out).toMatchSnapshot()
  })

  it('renders the staged-entities block with promotion instructions when a staged entity exists', () => {
    const contextWithStaged = {
      ...m2Context,
      entities: [
        ...m2Context.entities,
        {
          id: 'char_2',
          kind: 'character',
          name: 'Lord Eldrin',
          description: 'An exiled noble.',
          status: 'staged',
          injectionMode: 'auto',
        },
      ],
    }
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, contextWithStaged)
    expect(rendered).toContain('# Staged characters (introduce when narratively appropriate)')
    expect(rendered).toContain('- [char_2] Lord Eldrin: An exiled noble.')
    expect(rendered).toContain(
      'include their ID (without brackets) in the trailing <scene_entities> block',
    )
  })

  it('omits the staged-entities block when there are no staged entities', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context)
    expect(rendered).not.toContain('# Staged characters')
  })

  it('renders the calendar vocabulary section when calendarVocabulary is provided', () => {
    const contextWithCalendar = {
      ...m2Context,
      calendarVocabulary: {
        baseUnitName: 'second',
        secondsPerBaseUnit: 1,
        tiers: [{ name: 'month', labels: ['January', 'February'] }],
      },
    }
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, contextWithCalendar)
    expect(rendered).toContain('# Calendar')
    expect(rendered).toContain('This story tracks time in seconds (1 seconds per second).')
    expect(rendered).toContain('month (January and February)')
  })

  it('omits the calendar section when calendarVocabulary is absent', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context)
    expect(rendered).not.toContain('# Calendar')
  })

  it('renders active locations with bracketed IDs regardless of scene membership', () => {
    const contextWithLocation = {
      ...m2Context,
      entities: [
        ...m2Context.entities,
        {
          id: 'loc_1',
          kind: 'location',
          name: 'The Keep',
          description: 'A weathered hilltop fortress.',
          status: 'active',
          injectionMode: 'auto',
        },
        {
          id: 'loc_2',
          kind: 'location',
          name: 'Old Mill',
          status: 'active',
          injectionMode: 'auto',
        },
      ],
    }
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, contextWithLocation)
    expect(rendered).toContain('# Known locations')
    expect(rendered).toContain('- [loc_1] The Keep: A weathered hilltop fortress.')
    expect(rendered).toContain('- [loc_2] Old Mill')
    expect(rendered).not.toContain('- [loc_2] Old Mill:')
  })

  it('omits the known-locations block when there are no active locations', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context)
    expect(rendered).not.toContain('# Known locations')
  })
})

describe('bundled per-turn template — piggybackFires gating', () => {
  const contextWithEverything = {
    ...m2Context,
    piggybackFires: false,
    entities: [
      ...m2Context.entities,
      {
        id: 'char_2',
        kind: 'character',
        name: 'Lord Eldrin',
        description: 'An exiled noble.',
        status: 'staged',
        injectionMode: 'auto',
      },
      {
        id: 'loc_1',
        kind: 'location',
        name: 'The Keep',
        description: 'A weathered hilltop fortress.',
        status: 'active',
        injectionMode: 'auto',
      },
    ],
    calendarVocabulary: {
      baseUnitName: 'second',
      secondsPerBaseUnit: 1,
      tiers: [{ name: 'month', labels: ['January', 'February'] }],
    },
  }

  it('keeps the staged/locations/calendar info sections but drops ID brackets, ID-usage instructions, and the state-emission macro when the fallback classifier will fire anyway', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, contextWithEverything)
    expect(rendered).toContain('## Aria')
    expect(rendered).not.toContain('## Aria [char_1]')
    expect(rendered).toContain('# Staged characters')
    expect(rendered).toContain('- Lord Eldrin: An exiled noble.')
    expect(rendered).not.toContain('[char_2]')
    expect(rendered).not.toContain(
      'include their ID (without brackets) in the trailing <scene_entities> block',
    )
    expect(rendered).toContain('# Known locations')
    expect(rendered).toContain('- The Keep: A weathered hilltop fortress.')
    expect(rendered).not.toContain('[loc_1]')
    expect(rendered).not.toContain('Use one of these IDs (without brackets) for <current_location>')
    expect(rendered).toContain('# Calendar')
    expect(rendered).not.toContain('<world_time_delta>')
    expect(rendered).not.toContain('<state>')
  })

  it('renders all of it when piggybackFires is true', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...contextWithEverything,
      piggybackFires: true,
    })
    expect(rendered).toContain('## Aria [char_1]')
    expect(rendered).toContain('# Staged characters')
    expect(rendered).toContain('# Known locations')
    expect(rendered).toContain('# Calendar')
    expect(rendered).toContain('<state>')
  })
})
