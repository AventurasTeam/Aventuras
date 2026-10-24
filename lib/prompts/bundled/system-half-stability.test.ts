import { describe, expect, it } from 'vitest'

import { emptyEntityView } from '@/lib/world'

import { templateGlobals, type TemplateHalf } from '../engine'
import { bundledPack, loadPack, renderTemplate, TEMPLATE_IDS, type TemplateId } from '../index'

// architecture.md → System and user halves: a system half must render byte-identically from call
// to call unless the user changes what it reads, so it may read only what the story or the
// settings it resolves through fix (piggybackFires follows the narrative model's assignment).
const STABLE_SYSTEM_VARIABLES: readonly string[] = [
  'definition',
  'calendarVocabulary',
  'piggybackFires',
  'mentionedPlaces',
]

const { engine } = loadPack(bundledPack)

const perCallReads = (templateId: TemplateId, half?: TemplateHalf) =>
  [...templateGlobals(engine, templateId, half)].filter(
    (name) => !STABLE_SYSTEM_VARIABLES.includes(name),
  )

const STORY = {
  definition: {
    mode: 'adventure',
    setting: 'A drowned coast of salt marsh and broken keeps.',
    genre: { label: 'Fantasy', promptBody: 'Low fantasy: magic is rare, costly and feared.' },
    tone: { label: 'Wry', promptBody: 'Dry humour under real danger.' },
  },
  calendarVocabulary: {
    baseUnitName: 'day',
    secondsPerBaseUnit: 86400,
    tiers: [{ name: 'month', labels: ['Frostmoon', 'Thawmoon'] }],
  },
}

const entity = (id: string, kind: string, name: string, description: string) => ({
  id,
  kind,
  name,
  description,
  status: 'active',
  injectionMode: 'auto',
})
const ranked = (id: string, displayName: string, renderedText: string) => ({
  id,
  displayName,
  renderedText,
})
// A ranked entity carries the data the ranker measured; the template renders from it.
const rankedEntity = (id: string, name: string, description: string) => ({
  ...ranked(id, name, 'never rendered'),
  kind: 'character',
  name,
  description,
  status: 'active',
  state: { ...emptyEntityView('character'), voice: 'hoarse' },
})

// Two turns of one story: every per-call variable the story templates read takes a different
// value in each, so a per-call block in a system half changes it between them.
const TURN_A: Record<string, unknown> = {
  entities: [
    entity('c1', 'character', 'Kael', 'A courier with a stolen sigil.'),
    entity('l1', 'location', 'The Drowned Keep', 'Half sunk into the marsh.'),
    entity('i1', 'item', 'Courier’s seal', 'Black wax, cracked.'),
  ],
  sceneEntities: ['c1', 'l1'],
  structuralLocation: {
    id: 'l1',
    kind: 'location',
    status: 'active',
    name: 'The Drowned Keep',
    description: 'Half sunk into the marsh.',
  },
  placesListed: true,
  locationMap: [
    { id: 'l2', name: 'The Marsh', depth: 0 },
    { id: 'l1', name: 'The Drowned Keep', depth: 1 },
  ],
  locationMapUnplaced: [{ id: 'l4', name: 'Varn', depth: 0 }],
  currentLocationChain: ['The Marsh'],
  heldItems: [{ holderId: 'c1', items: [{ id: 'i1', name: 'Courier’s seal', equipped: false }] }],
  looseItems: [
    {
      ...entity('i2', 'item', 'a rusted lantern', 'Green with age.'),
      state: {
        ...emptyEntityView('item'),
        location: { id: 'l1', name: 'The Drowned Keep', status: 'active' },
      },
    },
  ],
  entries: [
    { position: 1, content: 'The marsh road ended at a wall of black water.' },
    { position: 2, content: 'Kael went first, testing the stones.' },
  ],
  lastTurns: [
    { position: 1, content: 'The marsh road ended at a wall of black water.' },
    { position: 2, content: 'Kael went first, testing the stones.' },
  ],
  structuralActiveThreads: [
    { id: 't1', status: 'active', title: 'Find the heir', description: 'Still open.' },
  ],
  structuralPinnedEntities: [
    { id: 'c3', kind: 'character', status: 'staged', name: 'Ilse', description: 'A ferrywoman.' },
  ],
  structuralSceneFactions: [
    { id: 'f1', kind: 'faction', status: 'active', name: 'The Tidewardens', description: null },
  ],
  namedCharacters: [entity('c5', 'character', 'Orrin', 'A lock-keeper.')],
  structuralPinnedLore: [{ id: 'lo1', title: 'House Eldrin', body: 'An exiled line.' }],
  structuralPinnedThreads: [
    { id: 't2', status: 'pending', title: 'The debt', description: 'Owed to the guild.' },
  ],
  retrievedEntities: [rankedEntity('c2', 'Mora', 'last seen at the ford.')],
  retrievedLore: [ranked('lo2', 'Veilstone', 'Veilstone\nA shard of the old moon.')],
  retrievedHappenings: [ranked('h1', 'The siege', 'The siege broke on the third night.')],
  retrievedThreads: [ranked('t3', 'The lost map', 'The lost map (resolved): torn in two.')],
  retrievedChapters: [ranked('ch1', 'Chapter One', 'Chapter One: the marsh road.')],
  suggestionsFire: true,
  suggestionSlots: [{ ref: 'cat1', label: 'Action', promptHint: 'act' }],
  suggestionCount: 2,
  refreshGuidance: '',
  worldTimeDeltaBasis: 'sinceLastAiReply',
}

const TURN_B: Record<string, unknown> = {
  entities: [
    entity('c1', 'character', 'Kael', 'A courier, now hunted.'),
    entity('c2', 'character', 'Mora', 'A smuggler.'),
    entity('l3', 'location', 'The Ford', 'Shallow and cold.'),
    {
      ...entity('c4', 'character', 'Vennick', 'A ferryman who keeps his own counsel.'),
      status: 'staged',
    },
  ],
  sceneEntities: ['c1', 'c2', 'l3'],
  structuralLocation: {
    id: 'l3',
    kind: 'location',
    status: 'active',
    name: 'The Ford',
    description: 'Shallow and cold.',
  },
  placesListed: false,
  locationMap: [
    { id: 'l3', name: 'The Ford', depth: 0 },
    { id: 'l2', name: 'The Marsh', depth: 0 },
  ],
  locationMapUnplaced: [],
  currentLocationChain: [],
  heldItems: [{ holderId: 'c2', items: [{ id: 'i3', name: 'a bone knife', equipped: true }] }],
  looseItems: [],
  entries: [{ position: 7, content: 'Mora waited at the ford with a lantern.' }],
  lastTurns: [
    { position: 5, content: 'The reeds closed behind Kael.' },
    { position: 6, content: 'I wade across.' },
    { position: 7, content: 'Mora waited at the ford with a lantern.' },
  ],
  structuralActiveThreads: [],
  structuralPinnedEntities: [],
  structuralSceneFactions: [],
  namedCharacters: [],
  structuralPinnedLore: [],
  structuralPinnedThreads: [],
  retrievedEntities: [],
  retrievedLore: [],
  retrievedHappenings: [],
  retrievedThreads: [],
  retrievedChapters: [],
  suggestionsFire: false,
  suggestionSlots: [
    { ref: 'cat1', label: 'Dialogue', promptHint: 'speak' },
    { ref: 'cat2', label: 'Explore', promptHint: 'look around' },
  ],
  suggestionCount: 3,
  refreshGuidance: 'Kael asks Mora about the heir.',
  worldTimeDeltaBasis: 'sinceUserAction',
}

const PASS_A: Record<string, unknown> = {
  turns: [{ handle: 't1', content: 'Kael falls at the ford.', scene: ['c1'], location: 'l1' }],
  entities: [
    {
      id: 'c1',
      name: 'Kael',
      kind: 'character',
      status: 'active',
      description: 'A courier.',
      keywords: ['the courier'],
    },
  ],
  places: [
    {
      id: 'l1',
      name: 'The ford',
      depth: 0,
      status: 'active',
      retiredReason: null,
      description: null,
      keywords: [],
    },
  ],
  placesUnplaced: [
    {
      id: 'l2',
      name: 'Varn',
      depth: 0,
      status: 'active',
      retiredReason: null,
      description: null,
      keywords: [],
    },
  ],
  relationships: [
    { subject: 'c1', subjectName: 'Kael', object: 'c2', objectName: 'Aria', kind: 'sister' },
  ],
  happenings: [{ id: 'hp1', title: 'The satchel was stolen' }],
  threads: [{ id: 'th1', title: 'Find the heir', status: 'active' }],
}

const PASS_B: Record<string, unknown> = {
  turns: [
    { handle: 't1', content: 'Aria hears of it from Jorin.', scene: [], location: null },
    { handle: 't2', content: 'She rides for the coast.', scene: ['c2'], location: null },
  ],
  entities: [
    {
      id: 'c2',
      name: 'Aria',
      kind: 'character',
      status: 'staged',
      description: 'His sister.',
      keywords: [],
    },
  ],
  places: [],
  placesUnplaced: [],
  relationships: [],
  happenings: [],
  threads: [],
}

type RenderCase = {
  templateId: TemplateId
  first: Record<string, unknown>
  second: Record<string, unknown>
  /** Text the system half shows under STORY, so the equality can't pass on two empty halves. */
  systemShows: string[]
}

const RENDER_CASES: RenderCase[] = [
  {
    templateId: TEMPLATE_IDS.perTurnNarrative,
    first: TURN_A,
    second: TURN_B,
    systemShows: [
      'A drowned coast of salt marsh and broken keeps.',
      'This story tracks time in days',
    ],
  },
  {
    templateId: TEMPLATE_IDS.piggybackFallbackClassifier,
    first: TURN_A,
    second: TURN_B,
    systemShows: ['This story tracks time in days'],
  },
  {
    templateId: TEMPLATE_IDS.periodicClassifier,
    first: PASS_A,
    second: PASS_B,
    systemShows: ['Rules:'],
  },
  {
    templateId: TEMPLATE_IDS.periodicClassifier,
    first: { ...PASS_A, mentionedPlaces: true },
    second: { ...PASS_B, mentionedPlaces: true },
    systemShows: ['Rules:', '- New places. Add a place the turns mention'],
  },
  {
    templateId: TEMPLATE_IDS.suggestionRefresh,
    first: TURN_A,
    second: TURN_B,
    systemShows: ['A drowned coast of salt marsh and broken keeps.'],
  },
]

// Stands in, on the bundled pack, for the deferred pack validator's system-half warning
// (parked.md → Pack validation contract).
describe('bundled system halves read only what the story fixes', () => {
  it.each(Object.values(TEMPLATE_IDS))('%s', (templateId) => {
    expect(perCallReads(templateId, 'system')).toEqual([])
  })

  // Positive control: the empty list above isn't the half-scoped read seeing nothing.
  it("reports a system half's reads", () => {
    const reads = [...templateGlobals(engine, TEMPLATE_IDS.perTurnNarrative, 'system')]
    expect(reads).toContain('definition')
    expect(reads).toContain('calendarVocabulary')
  })
})

describe('bundled system halves render byte-identically across calls', () => {
  // A variable equal in both contexts, or missing from one, can't show a per-call read; a
  // template reading a new variable fails here until both set it. Compares JSON values, not output.
  it.each(RENDER_CASES)(
    '$templateId: the two contexts differ in every per-call variable it reads',
    ({ templateId, first, second }) => {
      const reads = perCallReads(templateId)
      expect(reads.length).toBeGreaterThan(0)
      const unvaried = reads.filter(
        (name) =>
          !(name in first) ||
          !(name in second) ||
          JSON.stringify(first[name]) === JSON.stringify(second[name]),
      )
      expect(unvaried).toEqual([])
    },
  )

  describe.each([true, false])('piggybackFires: %s', (piggybackFires) => {
    it.each(RENDER_CASES)('$templateId', ({ templateId, first, second, systemShows }) => {
      const a = renderTemplate(templateId, { ...first, ...STORY, piggybackFires })
      const b = renderTemplate(templateId, { ...second, ...STORY, piggybackFires })

      expect(a.system).toBe(b.system)
      for (const text of systemShows) expect(a.system).toContain(text)
      // Positive control: the per-call contexts reach the prompt.
      expect(a.user).not.toBe(b.user)
    })
  })
})
