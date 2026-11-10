import { describe, expect, it } from 'vitest'

import { emptyEntityView } from '@/lib/world'

import { macroGlobals, templateGlobals, type TemplateHalf } from '../engine'
import {
  bundledPack,
  loadPack,
  MACRO_IDS,
  renderTemplate,
  TEMPLATE_IDS,
  type MacroId,
  type TemplateId,
} from '../index'
import { CLOSE_ONLY_CHAPTER_VARIABLES, TEMPLATE_GROUPS } from '../templateContextMap'

// architecture.md → System and user halves: a system half must render byte-identically from call
// to call unless the user changes what it reads, so it may read only what the story or the
// settings it resolves through fix (piggybackFires follows the narrative model's assignment), and
// the lead, whose name a reveal can change but whose id it must not read.
const STABLE_SYSTEM_VARIABLES: readonly string[] = [
  'definition',
  'calendarVocabulary',
  'piggybackFires',
  'mentionedPlaces',
  'mode',
  'composerWrapPov',
  'lead',
]

// C3: a close task's template holds the chapter or part in its system half, the one per-call read
// it may make there; its task's rows and the writes so far stay in its user half.
const CLOSE_TASK_TEMPLATES: readonly TemplateId[] = [
  TEMPLATE_IDS.closeLore,
  TEMPLATE_IDS.closeIdentity,
  TEMPLATE_IDS.closeThreads,
  TEMPLATE_IDS.closeUpkeep,
  TEMPLATE_IDS.closeLifecycle,
]
const CLOSE_SYSTEM_VARIABLES: readonly string[] = ['closeTurns']

// Only a chapter-group template is a close's, so the exemption can't reach another group's.
function closeTaskTemplates(
  list: readonly string[],
  groups: Readonly<Record<string, string>>,
): readonly string[] {
  const outside = list.filter((id) => groups[id] !== 'chapter')
  if (outside.length > 0)
    throw new Error(`close task templates outside the chapter group: ${outside.join(', ')}`)
  return list
}

const allowedPerCall = (templateId: string): readonly string[] =>
  closeTaskTemplates(CLOSE_TASK_TEMPLATES, TEMPLATE_GROUPS).includes(templateId)
    ? CLOSE_SYSTEM_VARIABLES
    : []

const unallowedSystemReads = (
  eng: Parameters<typeof templateGlobals>[0],
  templateId: string,
  allowed: readonly string[],
): string[] =>
  [...templateGlobals(eng, templateId, 'system')]
    .filter((name) => !STABLE_SYSTEM_VARIABLES.includes(name) && !allowed.includes(name))
    .toSorted()

const { engine } = loadPack(bundledPack)

const perCallReads = (templateId: TemplateId, half?: TemplateHalf) =>
  [...templateGlobals(engine, templateId, half)].filter(
    (name) => !STABLE_SYSTEM_VARIABLES.includes(name),
  )

const STORY = {
  mode: 'adventure',
  composerWrapPov: 'first',
  definition: {
    mode: 'adventure',
    narration: 'second',
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
  currentTime: 'Frostmoon 3, the third hour',
  lead: { id: 'c1', name: 'Kael' },
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
  currentTime: null,
  // The same lead under another placeholder: ids are allocated per call.
  lead: { id: 'c7', name: 'Kael' },
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
  lead: { id: 'c1', name: 'Kael' },
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
  lead: null,
}

// Two closes of one story: every per-call variable the metadata template reads differs between
// them; the mode is the story's, so it doesn't.
const CLOSE_A: Record<string, unknown> = {
  mode: 'adventure',
  entries: [
    { position: 1, kind: 'opening', content: 'The marsh road ended at a wall of black water.' },
    { position: 2, kind: 'user_action', content: 'I wade in.' },
    {
      position: 3,
      kind: 'ai_reply',
      content: 'The cold took Kael’s breath, and the sigil with it.',
    },
  ],
  previousChapterSummary: null,
  threads: [{ title: 'Find the heir', status: 'active' }],
}

const CLOSE_B: Record<string, unknown> = {
  mode: 'adventure',
  entries: [{ position: 31, kind: 'ai_reply', content: 'Mora waited at the ford with a lantern.' }],
  previousChapterSummary: 'Kael crossed the marsh and lost the sigil to the water.',
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
      'in which the user plays Kael',
      'A drowned coast of salt marsh and broken keeps.',
      'This story tracks time in days',
    ],
  },
  {
    templateId: TEMPLATE_IDS.piggybackFallbackClassifier,
    first: TURN_A,
    second: TURN_B,
    systemShows: ['This story tracks time in days', 'what the lead does, says or attempts'],
  },
  {
    templateId: TEMPLATE_IDS.periodicClassifier,
    first: PASS_A,
    second: PASS_B,
    systemShows: ['Rules for every list:', 'what the lead does, says or attempts'],
  },
  {
    templateId: TEMPLATE_IDS.periodicClassifier,
    first: { ...PASS_A, mentionedPlaces: true },
    second: { ...PASS_B, mentionedPlaces: true },
    systemShows: [
      'Rules for every list:',
      'what the lead does, says or attempts',
      '- New places. Add a place the turns mention',
    ],
  },
  {
    templateId: TEMPLATE_IDS.suggestionRefresh,
    first: TURN_A,
    second: TURN_B,
    systemShows: ['A drowned coast of salt marsh and broken keeps.'],
  },
  {
    templateId: TEMPLATE_IDS.chapterMetadata,
    first: CLOSE_A,
    second: CLOSE_B,
    systemShows: [
      '- Title. A few words naming the chapter',
      'marked with <user_turn> tags',
      'Each is what the lead does, says or attempts',
    ],
  },
]

// Stands in, on the bundled pack, for the deferred pack validator's system-half warning
// (parked.md → Pack validation contract).
describe('bundled system halves read only what the story fixes', () => {
  it.each(Object.values(TEMPLATE_IDS))('%s', (templateId) => {
    expect(unallowedSystemReads(engine, templateId, allowedPerCall(templateId))).toEqual([])
  })

  // Control: only a listed close template takes the exemption; no other template does.
  it('allows no per-call read to a template that is not a close task', () => {
    expect(allowedPerCall(TEMPLATE_IDS.chapterMetadata)).toEqual([])
  })

  // A task's rows in a system half would move the prefix every later task reuses: only the turns
  // pass. The probe reads every close-only variable, so a new one is held to the rule too.
  it('lets a close task template read the turns in its system half, and no other per-call variable', () => {
    const probe = 'tmpl_close_task_probe'
    const reads = CLOSE_ONLY_CHAPTER_VARIABLES.map((name) => `{{ ${name}.size }}`).join('')
    const { engine: probed } = loadPack({
      ...bundledPack,
      templates: {
        ...bundledPack.templates,
        [probe]: {
          group: 'chapter',
          system: `{{ mode }}${reads}{{ entries.size }}`,
          user: 'Begin.',
        },
      },
    })
    expect(unallowedSystemReads(probed, probe, CLOSE_SYSTEM_VARIABLES)).toEqual([
      'closeCharacters',
      'closeFactions',
      'closeLifecycleRows',
      'closeLore',
      'closeLoreLimits',
      'closeSoftCaps',
      'closeThreads',
      'closeUpkeepHappenings',
      'closeUpkeepRows',
      'closeWritesSoFar',
      'entries',
    ])
    expect(unallowedSystemReads(probed, probe, [])).toEqual([
      'closeCharacters',
      'closeFactions',
      'closeLifecycleRows',
      'closeLore',
      'closeLoreLimits',
      'closeSoftCaps',
      'closeThreads',
      'closeTurns',
      'closeUpkeepHappenings',
      'closeUpkeepRows',
      'closeWritesSoFar',
      'entries',
    ])
  })

  // C3's named list: exactly the templates whose system half holds the turns.
  it("names the close's task templates, which are the ones holding the turns in their system half", () => {
    const holding = Object.values(TEMPLATE_IDS).filter((id) =>
      templateGlobals(engine, id, 'system').has('closeTurns'),
    )
    expect(CLOSE_TASK_TEMPLATES).toEqual([
      TEMPLATE_IDS.closeLore,
      TEMPLATE_IDS.closeIdentity,
      TEMPLATE_IDS.closeThreads,
      TEMPLATE_IDS.closeUpkeep,
      TEMPLATE_IDS.closeLifecycle,
    ])
    expect([...holding].sort()).toEqual([...CLOSE_TASK_TEMPLATES].sort())
  })

  it('refuses a close task template outside the chapter group', () => {
    const fixture = 'tmpl_close_fixture'
    expect(() =>
      closeTaskTemplates([...CLOSE_TASK_TEMPLATES, fixture], {
        ...TEMPLATE_GROUPS,
        [fixture]: 'generationContext',
      }),
    ).toThrow(fixture)
    expect(() => closeTaskTemplates([fixture], TEMPLATE_GROUPS)).toThrow(fixture)
    expect(closeTaskTemplates(CLOSE_TASK_TEMPLATES, TEMPLATE_GROUPS)).toEqual(CLOSE_TASK_TEMPLATES)
  })

  // Every close task's system half opens with them, Happenings and Awareness too, which hold no
  // prose and take no exemption.
  it("the close's shared instructions", () => {
    const perCall = (macroId: MacroId) =>
      [...macroGlobals(engine, macroId)].filter((name) => !STABLE_SYSTEM_VARIABLES.includes(name))
    expect(perCall(MACRO_IDS.closeInstructions)).toEqual([])
    // Positive control: the prose macro's turns are per close, and the filter keeps them.
    expect(perCall(MACRO_IDS.closeProse)).toEqual(['closeTurns'])
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

// memory/chapter-close.md → Conversations: a part's tasks share their system half byte for byte,
// so the chapter stays cached across tool lists; each task's own rows sit in its user half.
describe("a close's task templates share one system half", () => {
  const CLOSE_TASK_TURNS = [
    { handle: 't1', kind: 'opening', content: 'The marsh road ended at a wall of black water.' },
    { handle: 't2', kind: 'user_action', content: 'I wade in.' },
    {
      handle: 't3',
      kind: 'ai_reply',
      content: 'The cold takes your breath, and the sigil with it.',
    },
  ]
  const SHARED = { mode: 'adventure', closeTurns: CLOSE_TASK_TURNS }
  const TASK_CONTEXTS: Readonly<Record<string, Record<string, unknown>>> = {
    [TEMPLATE_IDS.closeLore]: {
      closeLore: [
        { id: 'lo1', title: 'The Forgotten Hour' },
        { id: 'lo2', title: 'House Eldrin' },
      ],
      closeLoreLimits: { creates: 3, left: 2, bodyChars: 1200 },
      closeWritesSoFar: '- update_thread Find the heir (th1): description',
    },
    [TEMPLATE_IDS.closeIdentity]: {
      closeCharacters: [
        {
          id: 'c1',
          name: 'Kael',
          status: 'active',
          description: 'A courier.',
          traits: ['wary'],
          drives: ['deliver the sigil'],
          voice: 'Clipped.',
        },
      ],
      closeFactions: [
        {
          id: 'f1',
          name: 'The Tidewardens',
          status: 'active',
          description: '',
          standing: 'Feared.',
          agenda: ['hold the ford'],
        },
      ],
      closeWritesSoFar: '',
      closeSoftCaps: { traits: 8, drives: 6, agenda: 4 },
    },
    [TEMPLATE_IDS.closeThreads]: {
      closeThreads: [
        {
          id: 'th1',
          title: 'Find the heir',
          description: 'Still open.',
          status: 'active',
          injectionMode: 'always',
        },
      ],
      closeWritesSoFar: '- update_character Kael (c1): state.traits',
    },
    [TEMPLATE_IDS.closeUpkeep]: {
      closeUpkeepRows: [
        {
          id: 'l1',
          kind: 'location',
          name: 'The Drowned Keep',
          status: 'active',
          description: 'Half sunk into the marsh.',
          keywords: ['the keep'],
          condition: '',
          placement: 'top level',
          inScene: false,
        },
        {
          id: 'i1',
          kind: 'item',
          name: 'a rusted lantern',
          status: 'active',
          description: '',
          keywords: [],
          condition: 'Green with age.',
          placement: '',
          inScene: true,
        },
      ],
      closeUpkeepHappenings: [{ id: 'hp1', title: 'The siege' }],
      closeWritesSoFar: '- update_thread Find the heir (th1): description',
    },
    [TEMPLATE_IDS.closeLifecycle]: {
      closeLifecycleRows: [
        {
          id: 'c1',
          kind: 'character',
          name: 'Kael',
          status: 'active',
          retiredReason: '',
          collision: '',
        },
        {
          id: 'f1',
          kind: 'faction',
          name: 'The Tidewardens',
          status: 'active',
          retiredReason: '',
          collision: 'f2 "The Ebb Wardens" (duplicate)',
        },
      ],
      closeWritesSoFar: '- update_thread Find the heir (th1): description',
    },
  }

  it('gives every listed template its own context', () => {
    expect(Object.keys(TASK_CONTEXTS).sort()).toEqual([...CLOSE_TASK_TEMPLATES].sort())
  })

  it('renders the same system half for each task of one part, from its own context', () => {
    expect(CLOSE_TASK_TEMPLATES).toHaveLength(5)
    const prompts = CLOSE_TASK_TEMPLATES.map((id) =>
      renderTemplate(id, { ...SHARED, ...TASK_CONTEXTS[id] }),
    )
    const [first] = prompts
    for (const prompt of prompts) expect(prompt.system).toBe(first!.system)
    expect(first!.system).toContain('This is an automated system.')
    expect(first!.system).toContain(
      "## t2 (the user's turn)\n<user_turn>\nI wade in.\n</user_turn>",
    )
    // Positive control: each task's own rows reach its prompt.
    const user = (id: TemplateId) => prompts[CLOSE_TASK_TEMPLATES.indexOf(id)]!.user
    expect(user(TEMPLATE_IDS.closeLore)).toContain('- lo2: House Eldrin')
    expect(user(TEMPLATE_IDS.closeIdentity)).toContain('## c1: Kael\n- description: "A courier."')
    expect(user(TEMPLATE_IDS.closeThreads)).toContain('## th1: Find the heir (active, always)')
    expect(user(TEMPLATE_IDS.closeUpkeep)).toContain('## i1: a rusted lantern (item, in the scene)')
    expect(user(TEMPLATE_IDS.closeLifecycle)).toContain('- flag: f2 "The Ebb Wardens" (duplicate)')
  })

  it("renders the same system half under one context holding every task's variables", () => {
    const merged = Object.assign({}, SHARED, ...Object.values(TASK_CONTEXTS))
    const systems = CLOSE_TASK_TEMPLATES.map((id) => renderTemplate(id, merged).system)
    expect(new Set(systems).size).toBe(1)
  })

  // Control: the half isn't equal by being empty of the chapter; other turns change it.
  it('changes with the turns', () => {
    const id = TEMPLATE_IDS.closeIdentity
    const full = renderTemplate(id, { ...SHARED, ...TASK_CONTEXTS[id] }).system
    const shorter = renderTemplate(id, {
      ...SHARED,
      ...TASK_CONTEXTS[id],
      closeTurns: CLOSE_TASK_TURNS.slice(0, 1),
    }).system
    expect(shorter).not.toBe(full)
  })

  // C3: a part's tasks share one system half; the next part's tasks share another.
  it("renders one system half per part, a second part's apart from the first's", () => {
    const SECOND_PART_TURNS = [
      { handle: 't4', kind: 'user_action', content: 'I climb out onto the far bank.' },
      {
        handle: 't5',
        kind: 'ai_reply',
        content: 'The keep looms over the water, dark but for one window.',
      },
    ]
    const systemsOver = (closeTurns: readonly Record<string, string>[]) =>
      CLOSE_TASK_TEMPLATES.map(
        (id) => renderTemplate(id, { ...SHARED, ...TASK_CONTEXTS[id], closeTurns }).system,
      )

    const first = systemsOver(CLOSE_TASK_TURNS)
    const second = systemsOver(SECOND_PART_TURNS)

    expect(CLOSE_TASK_TEMPLATES).toHaveLength(5)
    expect(new Set(first).size).toBe(1)
    expect(new Set(second).size).toBe(1)
    expect(second[0]).not.toBe(first[0])
    expect(second[0]).toContain(
      "## t4 (the user's turn)\n<user_turn>\nI climb out onto the far bank.\n</user_turn>",
    )
    expect(second[0]).not.toContain('I wade in.')
  })
})

// architecture.md → System and user halves: the one change besides the story and its settings.
describe("a lead's rename", () => {
  const LEAD_SYSTEM_TEMPLATES = Object.values(TEMPLATE_IDS).filter((id) =>
    templateGlobals(engine, id, 'system').has('lead'),
  )

  it('is read by the narrator', () => {
    expect(LEAD_SYSTEM_TEMPLATES).toContain(TEMPLATE_IDS.perTurnNarrative)
  })

  it.each(LEAD_SYSTEM_TEMPLATES)('changes the system half of %s', (templateId) => {
    const before = renderTemplate(templateId, { ...TURN_A, ...STORY })
    const after = renderTemplate(templateId, {
      ...TURN_A,
      ...STORY,
      lead: { id: 'c1', name: 'Kael Varro' },
    })
    expect(after.system).not.toBe(before.system)
    expect(after.system).toContain('Kael Varro')
  })

  it.each(LEAD_SYSTEM_TEMPLATES)('never brackets its id in the system half of %s', (templateId) => {
    const { system } = renderTemplate(templateId, {
      ...TURN_A,
      ...STORY,
      piggybackFires: true,
      lead: { id: 'LEAD-ID-MARKER', name: 'Kael' },
    })
    expect(system).not.toContain('LEAD-ID-MARKER')
  })
})
