import { describe, expect, it } from 'vitest'

import { renderTemplate, TEMPLATE_IDS } from '../index'

const PLACES_INSTRUCTION =
  'Use an ID from Places for <current_location>, or declare a new one with <new_location> in the state block below when the scene settles somewhere new.'

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
  locationMap: [],
  currentLocationChain: [],
  heldItems: [],
  looseItems: [],
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
  const out = renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context).user

  it('emits no dangling section headers for empty genre/tone/setting', () => {
    const { system } = renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context)
    expect(system).not.toContain('# Setting')
    expect(system).not.toContain('# Genre')
    expect(system).not.toContain('# Tone')
  })

  it('still renders the in-scene character and the entry buffer', () => {
    expect(out).toContain('# In scene')
    expect(out).toContain('## Aria [char_1]')
    expect(out).toContain('The gate groaned open.')
    expect(out).toContain('Aria stepped through.')
  })

  it('matches the recorded snapshot', () => {
    expect(renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context)).toMatchSnapshot()
  })

  // Both branches asserted directly: the snapshot pins whichever one the fixture
  // happens to select, so it would freeze one wording and never notice the other
  // breaking.
  it('measures the delta from the previous entry when the action consumed no time', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      piggybackFires: true,
      worldTimeDeltaBasis: 'sinceLastAiReply',
    }).user
    expect(rendered).toContain("including any time the user's action itself took")
  })

  it("measures the delta from the action's end when the action already advanced time", () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      piggybackFires: true,
      worldTimeDeltaBasis: 'sinceUserAction',
    }).user
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
        locationMap: [
          { id: 'loc_0', name: 'Highmoor', depth: 0 },
          { id: 'loc_1', name: 'The Keep', depth: 1 },
          { id: 'loc_2', name: 'The Gatehouse', depth: 2 },
          { id: 'loc_3', name: 'Lowmarsh', depth: 0 },
        ],
        currentLocationChain: ['Highmoor'],
        heldItems: [
          {
            holderId: 'char_1',
            items: [
              { id: 'item_1', name: 'Silver Key', equipped: false },
              { id: 'item_2', name: 'worn sword', equipped: true },
            ],
          },
        ],
        looseItems: [{ id: 'item_3', name: 'the iron chest' }],
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

  // The ID instructions refer back ("off-scene character above", "an ID from Places"); a block
  // moved below them silently breaks promotion and location choice; the snapshot shows a hunk move.
  it('renders the memory blocks and the map before the instructions that refer back to them', () => {
    const withMemory = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      locationMap: [{ id: 'loc_1', name: 'The Keep', depth: 0 }],
      retrievedEntities: [
        { id: 'char_2', displayName: 'Mira', renderedText: 'Mira (currently elsewhere).' },
      ],
    }).user

    const blocks = withMemory.indexOf('# Elsewhere in the world')
    const places = withMemory.indexOf('# Places')
    expect(blocks).toBeGreaterThan(-1)
    expect(places).toBeGreaterThan(-1)
    expect(blocks).toBeLessThan(withMemory.indexOf('off-scene character above'))
    expect(places).toBeLessThan(withMemory.indexOf(PLACES_INSTRUCTION))
  })

  // The builder hands over an already-composed window (cadence.md → Composition
  // rule), which partialChapterBuffer alone cannot reproduce: a template that
  // re-trims by it sends the model less prose than the caller composed.
  it('renders every entry it is handed, ignoring partialChapterBuffer', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      userSettings: { partialChapterBuffer: 1 },
      entries: [{ content: 'alpha-line' }, { content: 'beta-line' }, { content: 'gamma-line' }],
    }).user
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
    }).user
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
    }).user
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
    }).user
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
    const { system, user } = renderTemplate(TEMPLATE_IDS.perTurnNarrative, contextWithCalendar)
    expect(system).toContain('# Calendar')
    expect(system).toContain('This story tracks time in seconds (1 seconds per second).')
    expect(system).toContain('month (January and February)')
    expect(user).not.toContain('# Calendar')
  })

  it('omits the calendar section when calendarVocabulary is absent', () => {
    const { system } = renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context)
    expect(system).not.toContain('# Calendar')
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
    }).user
    expect(rendered).toContain('# Current location')
    expect(rendered).toContain('[loc_1] The Keep: A weathered hilltop fortress.')
  })

  it('drops the colon on a current location with no description', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      structuralLocation: { id: 'loc_2', kind: 'location', status: 'active', name: 'Old Mill' },
    }).user
    expect(rendered).toContain('[loc_2] Old Mill')
    expect(rendered).not.toContain('[loc_2] Old Mill:')
  })

  // structuralLocation is null for a staged, retired or gone location; guarding on it, not on
  // currentLocationId, avoids a dangling header; the map must not hang off it (templateContextMap).
  it('omits the location block when the floor seats none, but still offers the map', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      currentLocationId: 'loc_1',
      structuralLocation: null,
      locationMap: [{ id: 'loc_2', name: 'Old Mill', depth: 0 }],
    }).user
    expect(rendered).not.toContain('# Current location')
    expect(rendered).toContain('# Places\n[loc_2] Old Mill\n')
    expect(rendered).toContain(PLACES_INSTRUCTION)
    expect(rendered).toContain('## Aria [char_1]')
  })

  // The map, not retrieval, makes a move expressible: a place retrieval never ranked still carries
  // an ID the model can name (piggyback.md → What the writer sees).
  it('offers every listed place as a <current_location> target, retrieved or not', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      structuralLocation: {
        id: 'loc_1',
        kind: 'location',
        status: 'active',
        name: 'The Keep',
        description: 'A weathered hilltop fortress.',
      },
      locationMap: [
        { id: 'loc_1', name: 'The Keep', depth: 0 },
        { id: 'loc_9', name: 'The Market', depth: 0 },
      ],
    }).user
    expect(rendered).toContain('# Places\n[loc_1] The Keep\n[loc_9] The Market\n')
    expect(rendered).toContain(PLACES_INSTRUCTION)
  })

  // An instruction naming "an ID from Places" has no referent without the block.
  it('drops the map and its instruction when the branch has no listed place', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      retrievedEntities: [
        {
          id: 'char_9',
          displayName: 'Mira',
          renderedText: 'Mira (currently elsewhere): A courier.',
        },
      ],
    }).user
    expect(rendered).not.toContain('# Places')
    expect(rendered).not.toContain('Use an ID from Places')
    // Positive control: the ranked row and its own instruction still render, so
    // the exclusion above is not passing on an empty block.
    expect(rendered).toContain('[char_9] Mira (currently elsewhere): A courier.')
    expect(rendered).toContain('enters the scene, include their ID')
  })

  // locationIds stays a pinned variable for custom packs; the bundled template uses the map.
  it('does not render locationIds', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      locationIds: ['loc_1'],
    }).user
    expect(rendered).not.toContain('loc_1')
    expect(rendered).toContain('## Aria [char_1]')
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
    }).user
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
    }).user
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
    }).user
    expect(rendered).toContain('## Aria [char_1]\n\n## Bex [char_2]\nA quiet smith.')
  })

  // Names only on the map: an off-scene place's description still competes for retrieval budget.
  it('lists an off-scene location on the map by name, without its description', () => {
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
      locationMap: [{ id: 'loc_1', name: 'The Keep', depth: 0 }],
    }).user
    expect(rendered).toContain('# Places\n[loc_1] The Keep\n')
    expect(rendered).not.toContain('A weathered hilltop fortress.')
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
    locationMap: [{ id: 'loc_1', name: 'The Keep', depth: 0 }],
    heldItems: [
      { holderId: 'char_1', items: [{ id: 'item_1', name: 'Silver Key', equipped: false }] },
    ],
    looseItems: [{ id: 'item_7', name: 'the iron chest' }],
    calendarVocabulary: {
      baseUnitName: 'second',
      secondsPerBaseUnit: 1,
      tiers: [{ name: 'month', labels: ['January', 'February'] }],
    },
  }

  it('keeps the memory/location/calendar info sections but drops ID brackets, ID-usage instructions, and the state-emission macro when the fallback classifier will fire anyway', () => {
    const { system, user } = renderTemplate(TEMPLATE_IDS.perTurnNarrative, contextWithEverything)
    expect(user).toContain('## Aria')
    expect(user).not.toContain('## Aria [char_1]')
    expect(user).toContain('# Elsewhere in the world')
    expect(user).toContain('Lord Eldrin (available to introduce): An exiled noble.')
    expect(user).not.toContain('[char_2]')
    expect(user).not.toContain(
      'include their ID (without brackets) in the trailing <scene_entities> block',
    )
    expect(user).toContain('# Current location')
    expect(user).toContain('The Keep: A weathered hilltop fortress.')
    expect(user).not.toContain('[loc_1]')
    expect(user).not.toContain('Use an ID from Places')
    expect(user).toContain('# Places\nThe Keep\n')
    expect(user).toContain('Holds: Silver Key\n')
    expect(user).toContain('Here: the iron chest\n')
    expect(user).not.toContain('[item_')
    expect(system).toContain('# Calendar')
    expect(system).not.toContain('<world_time_delta>')
    expect(user).not.toContain('<world_time_delta>')
    expect(user).not.toContain('<state>')
  })

  it('renders all of it when piggybackFires is true', () => {
    const { system, user } = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...contextWithEverything,
      piggybackFires: true,
    })
    expect(user).toContain('## Aria [char_1]')
    expect(user).toContain('[char_2] Lord Eldrin')
    expect(user).toContain('[loc_1] The Keep')
    expect(user).toContain('# Places\n[loc_1] The Keep\n')
    expect(user).toContain('Holds: [item_1] Silver Key\n')
    expect(user).toContain('Here: [item_7] the iron chest\n')
    expect(user).toContain(PLACES_INSTRUCTION)
    expect(system).toContain('# Calendar')
    expect(system).toContain('into a seconds delta on <world_time_delta> using these units.')
    expect(user).toContain('<state>')
  })
})

describe('bundled per-turn template — the location map and item lines', () => {
  const KEEP = {
    id: 'loc_1',
    kind: 'location',
    status: 'active',
    name: 'The Keep',
    description: 'A weathered hilltop fortress.',
  }
  const MAP = [
    { id: 'loc_0', name: 'Highmoor', depth: 0 },
    { id: 'loc_1', name: 'The Keep', depth: 1 },
    { id: 'loc_2', name: 'The Gatehouse', depth: 2 },
    { id: 'loc_3', name: 'Lowmarsh', depth: 0 },
  ]
  const HELD = [
    {
      holderId: 'char_1',
      items: [
        { id: 'item_1', name: 'Silver Key', equipped: false },
        { id: 'item_2', name: 'worn sword', equipped: true },
      ],
    },
  ]
  const render = (over: Record<string, unknown>) =>
    renderTemplate(TEMPLATE_IDS.perTurnNarrative, { ...m2Context, ...over }).user

  it('nests the map two spaces per level, with IDs when piggyback fires', () => {
    expect(render({ locationMap: MAP })).toContain(
      '# Places\n[loc_0] Highmoor\n  [loc_1] The Keep\n    [loc_2] The Gatehouse\n[loc_3] Lowmarsh\n',
    )
  })

  it('renders the map by name alone when piggyback does not fire', () => {
    expect(render({ piggybackFires: false, locationMap: MAP })).toContain(
      '# Places\nHighmoor\n  The Keep\n    The Gatehouse\nLowmarsh\n',
    )
  })

  // piggyback.md → What the writer sees: a retired place is listed without an id, with its reason.
  const RETIRED_MAP = [
    { retired: false, id: 'loc_0', name: 'Highmoor', depth: 0, retiredReason: null },
    { retired: true, id: null, name: 'Saltmere', depth: 1, retiredReason: 'swallowed by the rift' },
    { retired: true, id: null, name: 'the Drowned Chapel', depth: 2, retiredReason: null },
  ]

  it('renders a retired place without an id, with its reason or none', () => {
    expect(render({ locationMap: RETIRED_MAP })).toContain(
      '# Places\n[loc_0] Highmoor\n  Saltmere (retired: swallowed by the rift)\n    the Drowned Chapel (retired)\n',
    )
  })

  it('marks a retired place when piggyback does not fire', () => {
    expect(render({ piggybackFires: false, locationMap: RETIRED_MAP })).toContain(
      '# Places\nHighmoor\n  Saltmere (retired: swallowed by the rift)\n    the Drowned Chapel (retired)\n',
    )
  })

  it('puts the map after the current location and before the memory blocks', () => {
    const rendered = render({
      structuralLocation: KEEP,
      locationMap: MAP,
      retrievedEntities: [
        { id: 'char_2', displayName: 'Mira', renderedText: 'Mira (currently elsewhere).' },
      ],
    })
    const location = rendered.indexOf('# Current location')
    const places = rendered.indexOf('# Places')
    expect(location).toBeGreaterThan(-1)
    expect(location).toBeLessThan(places)
    expect(places).toBeLessThan(rendered.indexOf('# Elsewhere in the world'))
  })

  it('renders the current location with its chain of listed ancestors, nearest first', () => {
    const rendered = render({
      structuralLocation: {
        ...KEEP,
        id: 'loc_2',
        name: 'The Gatehouse',
        description: 'Two towers and a rusted portcullis.',
      },
      currentLocationChain: ['The Keep', 'Highmoor'],
    })
    expect(rendered).toContain(
      '[loc_2] The Gatehouse — in The Keep › Highmoor: Two towers and a rusted portcullis.\n',
    )
  })

  it('renders no chain for a top-level place', () => {
    const rendered = render({ structuralLocation: KEEP })
    expect(rendered).toContain('[loc_1] The Keep: A weathered hilltop fortress.\n')
    expect(rendered).not.toContain(' — in ')
  })

  it('lists the items lying at the current location', () => {
    const rendered = render({
      structuralLocation: KEEP,
      looseItems: [
        { id: 'item_7', name: 'the iron chest' },
        { id: 'item_8', name: 'a coil of rope' },
      ],
    })
    expect(rendered).toContain(
      '[loc_1] The Keep: A weathered hilltop fortress.\nHere: [item_7] the iron chest, [item_8] a coil of rope\n',
    )
  })

  it('omits the Here line when nothing lies at the current location', () => {
    const rendered = render({ structuralLocation: KEEP })
    expect(rendered).not.toContain('Here:')
    expect(rendered).toContain('# Current location')
  })

  it('lists what an in-scene character holds under its own entry, equipped marked', () => {
    expect(render({ heldItems: HELD })).toContain(
      '## Aria [char_1]\nA wary scout.\nHolds: [item_1] Silver Key, [item_2] worn sword (equipped)\n',
    )
  })

  it('drops the held-item IDs when piggyback does not fire', () => {
    expect(render({ piggybackFires: false, heldItems: HELD })).toContain(
      '## Aria\nA wary scout.\nHolds: Silver Key, worn sword (equipped)\n',
    )
  })

  it('puts the Holds line straight under a holder with no description', () => {
    const rendered = render({
      entities: [{ ...m2Context.entities[0], description: null }],
      heldItems: HELD,
    })
    expect(rendered).toContain('## Aria [char_1]\nHolds: [item_1] Silver Key')
  })

  // piggyback.md → What the writer sees.
  it('does not repeat a held item in the scene list', () => {
    const rendered = render({
      sceneEntities: ['char_1', 'item_1', 'item_9', 'char_2'],
      entities: [
        ...m2Context.entities,
        {
          id: 'item_1',
          kind: 'item',
          name: 'Silver Key',
          description: 'Cold to the touch.',
          status: 'active',
          injectionMode: 'auto',
        },
        {
          id: 'item_9',
          kind: 'item',
          name: 'A lantern',
          description: 'Still lit.',
          status: 'active',
          injectionMode: 'auto',
        },
        {
          id: 'char_2',
          kind: 'character',
          name: 'Bex',
          description: 'A quiet smith.',
          status: 'active',
          injectionMode: 'auto',
        },
      ],
      heldItems: HELD,
    })
    expect(rendered).not.toContain('## Silver Key')
    expect(rendered).not.toContain('Cold to the touch.')
    // Positive controls: an unheld item keeps its entry; a non-holder gets no Holds line.
    expect(rendered).toContain('## A lantern [item_9]\nStill lit.\n')
    expect(rendered).toContain('## Bex [char_2]\nA quiet smith.\n\n')
    expect(rendered.split('Holds:')).toHaveLength(2)
  })

  it('does not repeat an item held by any in-scene character, not only the last holder', () => {
    const rendered = render({
      sceneEntities: ['char_1', 'char_2', 'item_1'],
      entities: [
        ...m2Context.entities,
        { ...m2Context.entities[0], id: 'char_2', name: 'Bex', description: 'A quiet smith.' },
        {
          id: 'item_1',
          kind: 'item',
          name: 'Silver Key',
          description: 'Cold to the touch.',
          status: 'active',
          injectionMode: 'auto',
        },
      ],
      heldItems: [
        { holderId: 'char_1', items: [{ id: 'item_1', name: 'Silver Key', equipped: false }] },
        { holderId: 'char_2', items: [{ id: 'item_2', name: 'hammer', equipped: false }] },
      ],
    })
    expect(rendered).not.toContain('## Silver Key')
    expect(rendered).toContain('## Aria [char_1]\nA wary scout.\nHolds: [item_1] Silver Key\n')
    expect(rendered).toContain('## Bex [char_2]\nA quiet smith.\nHolds: [item_2] hammer\n')
  })

  it('gives a Holds line only to the character that holds the items', () => {
    const rendered = render({
      sceneEntities: ['char_1', 'char_2'],
      entities: [
        ...m2Context.entities,
        { ...m2Context.entities[0], id: 'char_2', name: 'Bex', description: 'A quiet smith.' },
      ],
      heldItems: HELD,
    })
    expect(rendered.split('Holds:')).toHaveLength(2)
    expect(rendered).toContain('## Bex [char_2]\nA quiet smith.\n\n')
  })
})

describe('bundled per-turn template — create instructions', () => {
  const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context).user

  // A model copies the skeleton's order, and canon's example declares before it uses; the parser
  // doesn't care. <scene_entities>, which may name a new item, still leads.
  it('shows the creation tags in the state block, <new_location> above <current_location> and <new_item> above <transfers>', () => {
    const newLocation = rendered.indexOf('<new_location handle="new:')
    const newItem = rendered.indexOf('<new_item handle="new:')
    expect(newLocation).toBeGreaterThan(-1)
    expect(newItem).toBeGreaterThan(-1)
    expect(newLocation).toBeLessThan(rendered.indexOf('<current_location>'))
    expect(newItem).toBeLessThan(rendered.indexOf('<transfers>'))
    expect(rendered).toContain('<item id="item ID, or the handle of a new_item above"')
  })

  it('offers an ID from Places for <current_location> only when the map lists a place', () => {
    expect(rendered).toContain(
      '<current_location>the handle of a new_location above</current_location>',
    )
    expect(rendered).not.toContain('<current_location>the ID from Places')
    const withPlaces = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      locationMap: [{ id: 'loc_1', name: 'The Keep', depth: 0 }],
    }).user
    expect(withPlaces).toContain(
      '<current_location>the ID from Places, or the handle of a new_location above</current_location>',
    )
  })

  it('explains handles and carries the significance rules', () => {
    expect(rendered).toContain('a handle that starts with new:')
    expect(rendered).toContain(
      "use a new place's handle like an ID only as the <current_location> or another new place's parent, and a new item's handle only as a transfer's item id or, when it is in the scene, in <scene_entities>.",
    )
    expect(rendered).toContain('Create a place only when the scene settles somewhere')
    expect(rendered).toContain('Create an item only when a character takes, receives or is given')
    expect(rendered).toContain('Apart from those handles, use only the IDs shown to you above')
  })

  // The parser decodes five XML entities but drops a create with malformed attributes (raw " < or >
  // in the name) or a raw < in the description, so the model must be told how to write them.
  it("tells the model to escape a double quote, < or > in a create's name and a < in its description", () => {
    expect(rendered).toContain(
      "Write a double quote, < or > inside a create's name as &quot;, &lt; or &gt;, and a < inside its description as &lt;.",
    )
  })

  // A prompt that keeps new places and items out of the block starves the create path.
  it('does not tell the model to leave new places and items out of the block', () => {
    expect(rendered).not.toContain('Only reference items and locations that already have an ID')
    expect(rendered).not.toContain('describe it in prose only')
  })

  it('leaves the create instructions out when piggyback does not fire', () => {
    const off = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...m2Context,
      piggybackFires: false,
    }).user
    expect(off).not.toContain('<new_location')
    expect(off).not.toContain('Create a place only when')
    expect(off).not.toContain('&quot;')
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
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, suggestionContext).user
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
    const withState = renderTemplate(TEMPLATE_IDS.perTurnNarrative, suggestionContext).user
    expect(withState).toContain('never inside the prose itself')

    const withoutState = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...suggestionContext,
      piggybackFires: false,
    }).user
    expect(withoutState).toContain('never inside the prose itself')
  })

  it('omits the suggestion-emission macro when suggestionsFire is false', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...suggestionContext,
      suggestionsFire: false,
    }).user
    expect(rendered).not.toContain('<suggestions>')
  })

  it('joins the state block and the suggestions block with a single newline, no blank line, when both fire', () => {
    const rendered = renderTemplate(TEMPLATE_IDS.perTurnNarrative, suggestionContext).user
    expect(rendered).toContain('off-scene).\nAppend exactly one <suggestions> block')
  })

  it('places the suggestions block one blank line below the story when piggybackFires is false', () => {
    const { system, user } = renderTemplate(TEMPLATE_IDS.perTurnNarrative, {
      ...suggestionContext,
      piggybackFires: false,
    })
    expect(user).not.toContain('<state>')
    expect(user).toContain('Aria stepped through.\n\nAppend exactly one <suggestions> block')
    expect(system).toBe(
      'Write the next beat of the story as prose. Do not break character or address the reader.',
    )
  })
})

// architecture.md → System and user halves.
describe('bundled per-turn template — system and user halves', () => {
  const OUTPUT_FORMAT =
    'Write the next beat of the story as prose. Do not break character or address the reader.'
  const everything = {
    ...m2Context,
    definition: {
      mode: 'adventure',
      setting: 'A keep on a hill.',
      genre: { promptBody: 'High fantasy.' },
      tone: { promptBody: 'Dry humor.' },
    },
    calendarVocabulary: {
      baseUnitName: 'second',
      secondsPerBaseUnit: 1,
      tiers: [{ name: 'month', labels: ['January', 'February'] }],
    },
    structuralLocation: {
      id: 'loc_1',
      kind: 'location',
      status: 'active',
      name: 'The Keep',
      description: 'A weathered hilltop fortress.',
    },
    locationMap: [{ id: 'loc_1', name: 'The Keep', depth: 0 }],
    retrievedEntities: [
      { id: 'char_2', displayName: 'Mira', renderedText: 'Mira (currently elsewhere).' },
    ],
    suggestionsFire: true,
    suggestionCount: 2,
    suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'A decisive move.' }],
  }
  const render = (over: Record<string, unknown> = {}) =>
    renderTemplate(TEMPLATE_IDS.perTurnNarrative, { ...everything, ...over })
  const headings = (half: string) => half.split('\n').filter((line) => line.startsWith('# '))

  it('holds Setting, Genre, Tone and Calendar in that order, then the output-format line', () => {
    const { system } = render()
    expect(headings(system)).toEqual(['# Setting', '# Genre', '# Tone', '# Calendar'])
    expect(system).toContain('# Setting\nA keep on a hill.\n\n# Genre\nHigh fantasy.')
    expect(system.split('\n').at(-1)).toBe(OUTPUT_FORMAT)
  })

  it('keeps every per-call block in the user half, and the system blocks out of it', () => {
    const { system, user } = render()
    expect(headings(user)).toEqual([
      '# In scene',
      '# Current location',
      '# Places',
      '# Elsewhere in the world',
      '# Story so far',
    ])
    for (const perCall of [
      'off-scene character above',
      PLACES_INSTRUCTION,
      '<state>',
      '<suggestions>',
    ]) {
      expect(user).toContain(perCall)
      expect(system).not.toContain(perCall)
    }
    for (const heading of ['# Setting', '# Genre', '# Tone', '# Calendar']) {
      expect(user).not.toContain(heading)
    }
    expect(user).not.toContain(OUTPUT_FORMAT)
  })

  it('drops the <world_time_delta> sentence from the system half when piggyback does not fire', () => {
    const { system } = render({ piggybackFires: false })
    expect(system).toContain('Tiers: month (January and February).\n\n')
    expect(system).not.toContain('<world_time_delta>')
    expect(render().system).toContain(
      'into a seconds delta on <world_time_delta> using these units.',
    )
  })

  it('matches the recorded snapshot with every block filled', () => {
    expect(render()).toMatchSnapshot()
  })

  it('is the output-format line alone for a story with no setting, genre, tone or calendar', () => {
    expect(renderTemplate(TEMPLATE_IDS.perTurnNarrative, m2Context).system).toBe(OUTPUT_FORMAT)
  })

  // Neither half starts or ends on a blank line; whatever follows a half supplies its own separator.
  const flagCombinations = [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ]
  it.each(flagCombinations)(
    'starts and ends neither half on a blank line (piggybackFires %s, suggestionsFire %s)',
    (piggybackFires, suggestionsFire) => {
      const { system, user } = render({ piggybackFires, suggestionsFire })
      for (const half of [system, user]) {
        expect(half).not.toMatch(/^[ \t]*\n/)
        expect(half).not.toMatch(/\n[ \t]*\n[ \t]*$/)
      }
    },
  )

  it.each(flagCombinations)(
    'starts and ends neither half on a blank line with a calendar-only system half (piggybackFires %s, suggestionsFire %s)',
    (piggybackFires, suggestionsFire) => {
      const { system, user } = render({
        definition: {
          mode: 'adventure',
          setting: '',
          genre: { promptBody: '' },
          tone: { promptBody: '' },
        },
        piggybackFires,
        suggestionsFire,
      })
      expect(system).toMatch(/^# Calendar\n[^\n]+\n\n/)
      expect(headings(system)).toEqual(['# Calendar'])
      for (const half of [system, user]) {
        expect(half).not.toMatch(/^[ \t]*\n/)
        expect(half).not.toMatch(/\n[ \t]*\n[ \t]*$/)
      }
    },
  )

  // Each emission block opens with its own newline, which keeps one blank line below the story.
  it('keeps one blank line between the story and the state block, and ends on the story when nothing follows', () => {
    expect(render({ suggestionsFire: false }).user).toContain(
      'Aria stepped through.\n\nAfter your narrative prose, append exactly one <state> block',
    )
    expect(render({ piggybackFires: false, suggestionsFire: false }).user).toMatch(
      /\nAria stepped through\.\n$/,
    )
  })
})
