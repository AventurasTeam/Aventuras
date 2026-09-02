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
  // Empty, not absent. buildGenerationContext emits every retrieval bucket on
  // every call, so a fixture that omits them tests `nil.size > 0` — a
  // comparison that is false for the wrong reason and lets a broken guard pass.
  structuralLocation: null,
  locationIds: [],
  structuralActiveThreads: [],
  structuralPinnedEntities: [],
  structuralPinnedLore: [],
  structuralPinnedThreads: [],
  retrievedEntities: [],
  retrievedLore: [],
  retrievedHappenings: [],
  retrievedThreads: [],
  retrievedChapters: [],
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

  // Both branches asserted directly: the snapshot pins whichever one the fixture
  // happens to select, so it would freeze one wording and never notice the other
  // breaking.
  it('measures the delta from the previous entry when the action consumed no time', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      piggybackFires: true,
      worldTimeDeltaBasis: 'sinceLastAiReply',
    })
    expect(rendered).toContain("including any time the user's action itself took")
  })

  it("measures the delta from the action's end when the action already advanced time", () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      piggybackFires: true,
      worldTimeDeltaBasis: 'sinceUserAction',
    })
    expect(rendered).toContain("seconds elapsed since the end of the user's action")
    expect(rendered).not.toContain("including any time the user's action itself took")
  })

  // The retrieval-fed shape: where the memory blocks sit relative to the scene,
  // the location, and the ID instructions they are the referent for.
  it('matches the recorded snapshot with a retrieval pass behind it', () => {
    expect(
      renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
        ...m2Context,
        structuralLocation: {
          id: 'loc_1',
          kind: 'location',
          status: 'active',
          name: 'The Keep',
          description: 'A weathered hilltop fortress.',
        },
        locationIds: ['loc_1'],
        structuralActiveThreads: [
          { id: 'thr_1', status: 'active', title: 'The siege', description: 'Three weeks in.' },
        ],
        retrievedEntities: [
          {
            id: 'char_2',
            displayName: 'Mira',
            renderedText: 'Mira (currently elsewhere): A courier.',
          },
        ],
        retrievedLore: [
          {
            id: 'lore_1',
            displayName: 'Veilstone',
            renderedText: 'Veilstone\nA shard of the old moon.',
          },
        ],
      }),
    ).toMatchSnapshot()
  })

  // The ID instructions say "any off-scene character above" and "somewhere not
  // listed above" — words that point at the memory blocks. Move the include
  // below them and the prompt asks the model to look at something it has not
  // been shown yet; scene-entity promotion and location selection degrade with
  // no parse error, and the snapshot diff is a pure hunk move.
  it('renders the memory blocks before the instructions that refer back to them', () => {
    const withMemory = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      locationIds: ['loc_1'],
      retrievedEntities: [
        { id: 'char_2', displayName: 'Mira', renderedText: 'Mira (currently elsewhere).' },
      ],
    })

    const blocks = withMemory.indexOf('# Elsewhere in the world')
    expect(blocks).toBeGreaterThan(-1)
    expect(blocks).toBeLessThan(withMemory.indexOf('off-scene character above'))
    expect(blocks).toBeLessThan(withMemory.indexOf('not listed above'))
  })

  // The builder hands over an already-composed window (cadence.md → Composition
  // rule), which partialChapterBuffer alone cannot reproduce: a template that
  // re-trims by it sends the model less prose than the caller composed.
  it('renders every entry it is handed, ignoring partialChapterBuffer', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      userSettings: { partialChapterBuffer: 1 },
      entries: [{ content: 'alpha-line' }, { content: 'beta-line' }, { content: 'gamma-line' }],
    })
    expect(rendered).toContain('alpha-line')
    expect(rendered).toContain('beta-line')
    expect(rendered).toContain('gamma-line')
  })

  it('renders a ranked off-scene entity with promotion instructions', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      retrievedEntities: [
        {
          id: 'char_2',
          displayName: 'Lord Eldrin',
          renderedText: 'Lord Eldrin (available to introduce): An exiled noble.',
        },
      ],
    })
    expect(rendered).toContain('# Elsewhere in the world')
    expect(rendered).toContain('[char_2] Lord Eldrin (available to introduce): An exiled noble.')
    expect(rendered).toContain(
      'include their ID (without brackets) in the trailing <scene_entities> block',
    )
  })

  // The ranker owns off-scene entity spend now; a template that re-dumps the
  // roster would send rows nothing measured against the entity budget.
  it('does not dump the branch roster when nothing was retrieved', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
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
    })
    expect(rendered).not.toContain('# Elsewhere in the world')
    expect(rendered).not.toContain('Lord Eldrin')
    // The instruction has no referent without the block, so it must go too.
    expect(rendered).not.toContain('enters the scene, include their ID')
    // Positive control against a wholly empty render.
    expect(rendered).toContain('## Aria [char_1]')
  })

  it('renders the pinned-entity block from the structural floor, not from the roster', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      structuralPinnedEntities: [
        {
          id: 'char_3',
          kind: 'character',
          status: 'retired',
          name: 'Old Sesk',
          description: 'A ferryman long dead.',
        },
      ],
    })
    expect(rendered).toContain('# Elsewhere in the world')
    expect(rendered).toContain('[char_3] Old Sesk: A ferryman long dead.')
    // The bracketed id is meaningless without the instruction that explains it,
    // and the pinned half of the guard is the only thing keeping it here.
    expect(rendered).toContain('enters the scene, include their ID')
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

  it('renders the current location from the structural floor, with its ID', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      structuralLocation: {
        id: 'loc_1',
        kind: 'location',
        status: 'active',
        name: 'The Keep',
        description: 'A weathered hilltop fortress.',
      },
      locationIds: ['loc_1'],
    })
    expect(rendered).toContain('# Current location')
    expect(rendered).toContain('[loc_1] The Keep: A weathered hilltop fortress.')
    expect(rendered).toContain('for <current_location> when the scene is at that place: loc_1.')
  })

  it('drops the colon on a current location with no description', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      structuralLocation: { id: 'loc_2', kind: 'location', status: 'active', name: 'Old Mill' },
    })
    expect(rendered).toContain('[loc_2] Old Mill')
    expect(rendered).not.toContain('[loc_2] Old Mill:')
  })

  // structuralLocation is null when the scene names a location that is staged,
  // retired, or gone — guarding on it rather than on currentLocationId is what
  // keeps a dangling header out (templateContextMap → structuralLocation).
  it('omits the location block and its ID instruction when the floor seats none', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      currentLocationId: 'loc_1',
      structuralLocation: null,
    })
    expect(rendered).not.toContain('# Current location')
    expect(rendered).not.toContain('<current_location> when the scene is at that place')
    expect(rendered).toContain('## Aria [char_1]')
  })

  // The regression this pins: a ranked location renders with a bracketed ID, so
  // the scene moving there has to be expressible. locationIds is what tells the
  // template which of those IDs are places.
  it('offers a ranked location as a <current_location> target', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      structuralLocation: {
        id: 'loc_1',
        kind: 'location',
        status: 'active',
        name: 'The Keep',
        description: 'A weathered hilltop fortress.',
      },
      retrievedEntities: [
        {
          id: 'loc_9',
          displayName: 'The Market',
          renderedText: 'The Market (currently elsewhere): Stalls under sailcloth.',
        },
      ],
      locationIds: ['loc_1', 'loc_9'],
    })
    expect(rendered).toContain('[loc_9] The Market (currently elsewhere): Stalls under sailcloth.')
    expect(rendered).toContain(
      'for <current_location> when the scene is at that place: loc_1, loc_9.',
    )
  })

  // RetrievedRow is { id, displayName, renderedText } — no EntityKind — so an
  // instruction naming "the IDs above" would point <current_location> at an ID
  // set that can be entirely characters, and nothing downstream kind-checks what
  // comes back (lib/piggyback/apply.ts writes it through unvalidated).
  it('drops the <current_location> instruction when no ranked entity is a place', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      structuralLocation: null,
      retrievedEntities: [
        {
          id: 'char_9',
          displayName: 'Mira',
          renderedText: 'Mira (currently elsewhere): A courier.',
        },
      ],
      locationIds: [],
    })
    expect(rendered).not.toContain('# Current location')
    expect(rendered).not.toContain('for <current_location> when the scene is at that place')
    // Positive control: the ranked row and its own instruction still render, so
    // the exclusion above is not passing on an empty block.
    expect(rendered).toContain('[char_9] Mira (currently elsewhere): A courier.')
    expect(rendered).toContain('enters the scene, include their ID')
  })

  // The classifier can name one entity as both in-scene and the location; the
  // scene loop reads `entities` while the location block reads the floor, so
  // without the de-dupe the same row renders under both headers.
  it('renders an in-scene entity that is also the current location only once', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      sceneEntities: ['char_1', 'loc_1'],
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
      ],
      structuralLocation: {
        id: 'loc_1',
        kind: 'location',
        status: 'active',
        name: 'The Keep',
        description: 'A weathered hilltop fortress.',
      },
    })
    expect(rendered.split('The Keep')).toHaveLength(2)
    expect(rendered).not.toContain('## The Keep')
    // Positive control: the other in-scene row is untouched by the de-dupe.
    expect(rendered).toContain('## Aria [char_1]')
  })

  it('keeps the # In scene block out entirely when the location is its only member', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      sceneEntities: ['loc_1'],
      entities: [
        {
          id: 'loc_1',
          kind: 'location',
          name: 'The Keep',
          description: 'A weathered hilltop fortress.',
          status: 'active',
          injectionMode: 'auto',
        },
      ],
      structuralLocation: {
        id: 'loc_1',
        kind: 'location',
        status: 'active',
        name: 'The Keep',
        description: 'A weathered hilltop fortress.',
      },
    })
    expect(rendered).not.toContain('# In scene')
    // Positive control: the row itself still reaches the prompt, via the floor.
    expect(rendered).toContain('[loc_1] The Keep: A weathered hilltop fortress.')
  })

  // A second row after the null-description one pins the blank line the guard
  // removes; the block's own trailer would otherwise supply an identical one.
  it('drops the description line on an in-scene entity that has none', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      sceneEntities: ['char_1', 'char_2'],
      entities: [
        { ...m2Context.entities[0], description: null },
        { ...m2Context.entities[0], id: 'char_2', name: 'Bex', description: 'A quiet smith.' },
      ],
    })
    expect(rendered).toContain('## Aria [char_1]\n\n## Bex [char_2]\nA quiet smith.')
  })

  it('does not dump every active location — locations rank like any other entity', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
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
      ],
    })
    expect(rendered).not.toContain('The Keep')
    expect(rendered).toContain('## Aria [char_1]')
  })
})

describe('bundled per-turn template — piggybackFires gating', () => {
  const contextWithEverything = {
    ...m2Context,
    piggybackFires: false,
    retrievedEntities: [
      {
        id: 'char_2',
        displayName: 'Lord Eldrin',
        renderedText: 'Lord Eldrin (available to introduce): An exiled noble.',
      },
    ],
    structuralLocation: {
      id: 'loc_1',
      kind: 'location',
      status: 'active',
      name: 'The Keep',
      description: 'A weathered hilltop fortress.',
    },
    locationIds: ['loc_1'],
    calendarVocabulary: {
      baseUnitName: 'second',
      secondsPerBaseUnit: 1,
      tiers: [{ name: 'month', labels: ['January', 'February'] }],
    },
  }

  it('keeps the memory/location/calendar info sections but drops ID brackets, ID-usage instructions, and the state-emission macro when the fallback classifier will fire anyway', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, contextWithEverything)
    expect(rendered).toContain('## Aria')
    expect(rendered).not.toContain('## Aria [char_1]')
    expect(rendered).toContain('# Elsewhere in the world')
    expect(rendered).toContain('Lord Eldrin (available to introduce): An exiled noble.')
    expect(rendered).not.toContain('[char_2]')
    expect(rendered).not.toContain(
      'include their ID (without brackets) in the trailing <scene_entities> block',
    )
    expect(rendered).toContain('# Current location')
    expect(rendered).toContain('The Keep: A weathered hilltop fortress.')
    expect(rendered).not.toContain('[loc_1]')
    expect(rendered).not.toContain('for <current_location> when the scene is at that place')
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
    expect(rendered).toContain('[char_2] Lord Eldrin')
    expect(rendered).toContain('[loc_1] The Keep')
    expect(rendered).toContain('# Calendar')
    expect(rendered).toContain('<state>')
  })
})

describe('bundled per-turn template — suggestionsFire gating', () => {
  const suggestionContext = {
    ...m2Context,
    suggestionsFire: true,
    suggestionCount: 2,
    suggestionSlots: [
      { ref: 'cat1', label: 'Action', promptHint: 'A decisive move.' },
      { ref: 'cat2', label: 'Dialogue', promptHint: 'A line of speech.' },
    ],
  }

  it('includes the suggestion-emission macro when suggestionsFire is true', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, suggestionContext)
    expect(rendered).toContain('<suggestions>')
    // The id is its own labelled field, not bracketed beside the name: a model
    // that reads "[cat1] Action" as one label emits an unresolvable ref.
    expect(rendered).toContain('id "cat1" = Action — use it for: A decisive move.')
    // The skeleton interpolates a real id rather than the word "ref", which a
    // model would copy verbatim into the attribute.
    expect(rendered).toContain('<item category="cat1">')
  })

  // stripTrailingBlocks (lib/piggyback/parse.ts) cuts prose at the EARLIEST
  // trailing-tag occurrence anywhere in the raw output — a fragment that
  // doesn't forbid mid-prose emission risks the model burying <suggestions>
  // inside the narrative and silently truncating everything after it.
  it('forbids mid-prose emission regardless of whether the state block is present', () => {
    const withState = renderTemplate(TEMPLATE_IDS.perTurnNarrative, suggestionContext)
    expect(withState).toContain('never inside the prose itself')

    const withoutState = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...suggestionContext,
      piggybackFires: false,
    })
    expect(withoutState).toContain('never inside the prose itself')
  })

  it('omits the suggestion-emission macro when suggestionsFire is false', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...suggestionContext,
      suggestionsFire: false,
    })
    expect(rendered).not.toContain('<suggestions>')
  })

  it('joins the state block and the suggestions block with a single newline, no blank line, when both fire', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, suggestionContext)
    expect(rendered).toContain('off-scene).\nAppend exactly one <suggestions> block')
  })

  it('places the suggestions block directly after the narrative instruction when piggybackFires is false', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...suggestionContext,
      piggybackFires: false,
    })
    expect(rendered).not.toContain('<state>')
    expect(rendered).toContain(
      'Do not break character or address the reader.\nAppend exactly one <suggestions> block',
    )
  })
})
