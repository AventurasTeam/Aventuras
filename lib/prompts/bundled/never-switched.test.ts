import { describe, expect, it } from 'vitest'

import { emptyEntityView } from '@/lib/world'

import { renderTemplate, TEMPLATE_IDS, templateReads, type TemplateId } from '../index'

// Milestone 6's Definition of done: a story whose lead never changed gets no mark and no clause,
// and changes only in the lines canon gives it. The snapshot is that record: a variable a later
// prompt reads joins the story constants below, and the turns stay as they are.
const CLAUSE = 'except where a turn names another'

type Turn = { position: number; kind: string; content: string }
type Context = Record<string, unknown>

// Kael's story: adventure, narrated in the second person, Kael the lead throughout.
const LEAD_TURNS: Turn[] = [
  {
    position: 1,
    kind: 'opening',
    content:
      'The marsh road ended at a wall of black water. Beyond it, the Drowned Keep leaned out of the reeds.',
  },
  { position: 2, kind: 'user_action', content: 'I wade in, holding the sigil above my head.' },
  {
    position: 3,
    kind: 'ai_reply',
    content:
      'The cold takes your breath. Halfway across, the current tugs the sigil from your fingers, and it is gone.',
  },
  { position: 4, kind: 'user_action', content: 'I dive after it.' },
  {
    position: 5,
    kind: 'ai_reply',
    content:
      'Your hand closes on weed and silt. When you surface, Mora is watching from the keep’s broken stair, a lantern in her fist.',
  },
]

// A creative story told in the third person, with no lead.
const NO_LEAD_TURNS: Turn[] = [
  {
    position: 1,
    kind: 'opening',
    content: 'Rain had kept Gullhaven harbour quiet for three days.',
  },
  { position: 2, kind: 'user_action', content: 'Orrin finds a body under the pier at dawn.' },
  {
    position: 3,
    kind: 'ai_reply',
    content:
      'Orrin found it at first light: a sailor face down in the shallows, a gull feather tucked into his collar.',
  },
  { position: 4, kind: 'user_action', content: 'Ilse sends for the harbourmaster.' },
  {
    position: 5,
    kind: 'ai_reply',
    content:
      'Ilse sent the lock-keeper’s boy running, then stood over the body until the harbourmaster came down the steps, swearing at the rain.',
  },
]

// What each story's renders show of it: its last turn, and a part's last turn.
const LEAD_LAST = 'Mora is watching from the keep’s broken stair'
const NO_LEAD_LAST = 'swearing at the rain'
const LEAD_PART_LAST = 'the current tugs the sigil from your fingers'
const NO_LEAD_PART_LAST = 'a gull feather tucked into his collar'

// Each turn under the handle a periodic pass or a close cites.
const handled = (turns: readonly Turn[]) =>
  turns.map(({ position, kind, content }) => ({ handle: `t${position}`, kind, content }))

const row = (id: string, kind: string, name: string, description: string, state: object) => ({
  id,
  kind,
  name,
  description,
  status: 'active',
  injectionMode: 'auto',
  state,
})

const KAEL = row('c1', 'character', 'Kael', 'A courier carrying a stolen sigil.', {
  ...emptyEntityView('character'),
  voice: 'Clipped, wary.',
  traits: ['stubborn'],
  drives: ['deliver the sigil'],
})
const MORA = row('c2', 'character', 'Mora', 'A smuggler who knows the marsh paths.', {
  ...emptyEntityView('character'),
  voice: 'Low and amused.',
})
const KEEP = row('l1', 'location', 'The Drowned Keep', 'A fortress half sunk into the marsh.', {
  ...emptyEntityView('location'),
  condition: 'Flooded to the second stair.',
})
const ILSE = row(
  'c1',
  'character',
  'Ilse Varga',
  'A harbour clerk who misses nothing.',
  emptyEntityView('character'),
)
const ORRIN = row(
  'c2',
  'character',
  'Orrin',
  'A net-mender who works the pier at dawn.',
  emptyEntityView('character'),
)
const HARBOUR = row(
  'l1',
  'location',
  'Gullhaven harbour',
  'A grey harbour under a grey sky.',
  emptyEntityView('location'),
)

const NOTHING_RETRIEVED: Context = {
  structuralActiveThreads: [],
  structuralPinnedEntities: [],
  structuralSceneFactions: [],
  structuralPinnedLore: [],
  structuralPinnedThreads: [],
  retrievedEntities: [],
  retrievedLore: [],
  retrievedHappenings: [],
  retrievedThreads: [],
  retrievedChapters: [],
}

// The narrator's, the fallback's and the refresh's: one generation context serves all three.
const GENERATION_WITH_LEAD: Context = {
  ...NOTHING_RETRIEVED,
  definition: {
    mode: 'adventure',
    narration: 'second',
    setting: 'A drowned coast of salt marsh and broken keeps.',
    genre: { label: 'Fantasy', promptBody: 'Low fantasy: magic is rare, costly and feared.' },
    tone: { label: 'Wry', promptBody: 'Dry humour under real danger.' },
  },
  composerWrapPov: 'first',
  calendarVocabulary: {
    baseUnitName: 'day',
    secondsPerBaseUnit: 86400,
    tiers: [{ name: 'month', labels: ['Frostmoon', 'Thawmoon'] }],
  },
  piggybackFires: true,
  suggestionsFire: true,
  suggestionSlots: [
    { ref: 'cat1', label: 'Action', promptHint: 'act' },
    { ref: 'cat2', label: 'Dialogue', promptHint: 'speak' },
  ],
  suggestionCount: 2,
  refreshGuidance: '',
  worldTimeDeltaBasis: 'sinceLastAiReply',
  entities: [KAEL, MORA, KEEP],
  sceneEntities: ['c1', 'c2', 'l1'],
  structuralLocation: KEEP,
  placesListed: true,
  locationMap: [
    { id: 'l2', name: 'The Marsh', depth: 0 },
    { id: 'l1', name: 'The Drowned Keep', depth: 1 },
  ],
  locationMapUnplaced: [],
  currentLocationChain: ['The Marsh'],
  looseItems: [],
  currentTime: 'Frostmoon 3, the third hour',
  structuralActiveThreads: [
    {
      id: 't1',
      status: 'active',
      title: 'Deliver the sigil',
      description: 'To the keep’s last steward.',
    },
  ],
  retrievedHappenings: [
    {
      id: 'h1',
      displayName: 'The ford ambush',
      renderedText:
        'The ford ambush: riders cut the ferry rope, and Kael got across. Known by Kael.',
    },
  ],
  namedCharacters: [],
  entries: LEAD_TURNS,
  lastTurns: LEAD_TURNS,
  lead: { id: 'c1', name: 'Kael' },
}

const GENERATION_NO_LEAD: Context = {
  ...NOTHING_RETRIEVED,
  definition: {
    mode: 'creative',
    narration: 'third',
    setting: '',
    genre: { label: 'Mystery', promptBody: 'A slow harbour mystery: every clue costs someone.' },
    tone: { label: '', promptBody: '' },
  },
  composerWrapPov: 'third',
  calendarVocabulary: null,
  piggybackFires: true,
  suggestionsFire: true,
  suggestionSlots: [{ ref: 'cat1', label: 'Twist', promptHint: 'complicate things' }],
  suggestionCount: 3,
  refreshGuidance: 'Ilse questions the lock-keeper’s boy.',
  worldTimeDeltaBasis: 'sinceUserAction',
  entities: [ILSE, ORRIN, HARBOUR],
  sceneEntities: ['c1', 'c2', 'l1'],
  structuralLocation: HARBOUR,
  placesListed: true,
  locationMap: [{ id: 'l1', name: 'Gullhaven harbour', depth: 0 }],
  locationMapUnplaced: [],
  currentLocationChain: [],
  looseItems: [],
  currentTime: null,
  namedCharacters: [],
  entries: NO_LEAD_TURNS,
  lastTurns: NO_LEAD_TURNS,
  lead: null,
}

const PERIODIC_WITH_LEAD: Context = {
  mode: 'adventure',
  mentionedPlaces: false,
  entities: [
    {
      id: 'c1',
      name: 'Kael',
      kind: 'character',
      status: 'active',
      description: 'A courier carrying a stolen sigil.',
      keywords: ['the courier'],
      faction: null,
      standing: null,
    },
    {
      id: 'c2',
      name: 'Mora',
      kind: 'character',
      status: 'active',
      description: 'A smuggler who knows the marsh paths.',
      keywords: [],
      faction: 'f1',
      standing: null,
    },
    {
      id: 'f1',
      name: 'The Reed Runners',
      kind: 'faction',
      status: 'active',
      description: 'Smugglers of the marsh.',
      keywords: [],
      faction: null,
      standing: 'Tolerated by the keep’s steward',
    },
  ],
  places: [
    {
      id: 'l2',
      name: 'The Marsh',
      depth: 0,
      status: 'active',
      retiredReason: null,
      description: 'Salt marsh for a day in every direction.',
      keywords: [],
    },
    {
      id: 'l1',
      name: 'The Drowned Keep',
      depth: 1,
      status: 'active',
      retiredReason: null,
      description: 'A fortress half sunk into the marsh.',
      keywords: ['the keep'],
    },
  ],
  placesUnplaced: [],
  relationships: [
    { subject: 'c2', subjectName: 'Mora', object: 'c1', objectName: 'Kael', kind: 'a mark' },
  ],
  happenings: [{ id: 'hp1', title: 'The ford ambush' }],
  threads: [{ id: 'th1', title: 'Deliver the sigil', status: 'active' }],
  turns: handled(LEAD_TURNS).map((turn) => ({
    ...turn,
    scene: turn.handle === 't5' ? ['c1', 'c2'] : ['c1'],
    location: 'l1',
  })),
  lead: { id: 'c1', name: 'Kael' },
}

const PERIODIC_NO_LEAD: Context = {
  mode: 'creative',
  mentionedPlaces: false,
  entities: [
    {
      id: 'c1',
      name: 'Ilse Varga',
      kind: 'character',
      status: 'active',
      description: 'A harbour clerk who misses nothing.',
      keywords: [],
      faction: null,
      standing: null,
    },
    {
      id: 'c2',
      name: 'Orrin',
      kind: 'character',
      status: 'active',
      description: 'A net-mender who works the pier at dawn.',
      keywords: [],
      faction: null,
      standing: null,
    },
  ],
  places: [
    {
      id: 'l1',
      name: 'Gullhaven harbour',
      depth: 0,
      status: 'active',
      retiredReason: null,
      description: 'A grey harbour under a grey sky.',
      keywords: [],
    },
  ],
  placesUnplaced: [
    {
      id: 'l2',
      name: 'The lock-keeper’s cottage',
      depth: 0,
      status: 'active',
      retiredReason: null,
      description: null,
      keywords: [],
    },
  ],
  relationships: [],
  happenings: [],
  threads: [],
  turns: handled(NO_LEAD_TURNS).map((turn) => ({ ...turn, scene: ['c1', 'c2'], location: 'l1' })),
  lead: null,
}

// The story the chapter calls read: a later variable of the story joins these two.
const CHAPTER_STORY_WITH_LEAD: Context = {
  mode: 'adventure',
  lead: { name: 'Kael' },
  narration: 'second',
}
const CHAPTER_STORY_NO_LEAD: Context = { mode: 'creative', lead: null, narration: 'third' }

const PREVIOUS_SUMMARY =
  'Kael stole the sigil from the couriers’ guild and fled south along the marsh road.'
const OPEN_THREADS = [
  { title: 'Deliver the sigil', status: 'active' },
  { title: 'The guild’s hunters', status: 'pending' },
]

const CHAPTER_METADATA_WITH_LEAD: Context = {
  ...CHAPTER_STORY_WITH_LEAD,
  entries: LEAD_TURNS,
  previousChapterSummary: PREVIOUS_SUMMARY,
  threads: OPEN_THREADS,
}
const CHAPTER_METADATA_NO_LEAD: Context = {
  ...CHAPTER_STORY_NO_LEAD,
  entries: NO_LEAD_TURNS,
  previousChapterSummary: null,
  threads: [],
}

// A chapter's first part: its first three turns, read alone.
const CHAPTER_PART_WITH_LEAD: Context = {
  ...CHAPTER_STORY_WITH_LEAD,
  entries: LEAD_TURNS.slice(0, 3),
  previousChapterSummary: PREVIOUS_SUMMARY,
  threads: OPEN_THREADS,
}
const CHAPTER_PART_NO_LEAD: Context = {
  ...CHAPTER_STORY_NO_LEAD,
  entries: NO_LEAD_TURNS.slice(0, 3),
  previousChapterSummary: null,
  threads: [{ title: 'Who drowned the sailor', status: 'active' }],
}

// The merge reads no turn and takes neither the story's mode nor its lead.
const CHAPTER_MERGE_WITH_LEAD: Context = {
  partSummaries: [
    'You wade into the flood before the Drowned Keep, and the current takes the sigil from your fingers.',
    'You dive for the sigil and come up with weed; Mora watches from the keep’s broken stair.',
  ],
  previousChapterSummary: PREVIOUS_SUMMARY,
  threads: OPEN_THREADS,
}
const CHAPTER_MERGE_NO_LEAD: Context = {
  partSummaries: [
    'Orrin finds a drowned sailor under Gullhaven’s pier at dawn.',
    'Ilse sends for the harbourmaster and keeps watch over the body in the rain.',
  ],
  previousChapterSummary: null,
  threads: [],
}

// The story every close task reads: a later variable of the story joins these two.
const CLOSE_STORY_WITH_LEAD: Context = { mode: 'adventure', lead: { id: 'c1', name: 'Kael' } }
const CLOSE_STORY_NO_LEAD: Context = { mode: 'creative', lead: null }

// The five prose tasks hold the chapter's turns in their system half.
const CLOSE_PROSE_WITH_LEAD: Context = { ...CLOSE_STORY_WITH_LEAD, closeTurns: handled(LEAD_TURNS) }
const CLOSE_PROSE_NO_LEAD: Context = {
  ...CLOSE_STORY_NO_LEAD,
  closeTurns: handled(NO_LEAD_TURNS),
}

const CLOSE_LORE_WITH_LEAD: Context = {
  ...CLOSE_PROSE_WITH_LEAD,
  closeLore: [
    { id: 'lo1', title: 'The drowned sigils' },
    { id: 'lo2', title: 'The Reed Runners’ charter' },
  ],
  closeLoreLimits: { creates: 3, left: 2, bodyChars: 1200 },
  closeWritesSoFar: '',
}
const CLOSE_LORE_NO_LEAD: Context = {
  ...CLOSE_PROSE_NO_LEAD,
  closeLore: [],
  closeLoreLimits: { creates: 3, left: 3, bodyChars: 1200 },
  closeWritesSoFar: '',
}

const CLOSE_IDENTITY_WITH_LEAD: Context = {
  ...CLOSE_PROSE_WITH_LEAD,
  closeCharacters: [
    {
      id: 'c1',
      name: 'Kael',
      status: 'active',
      description: 'A courier carrying a stolen sigil.',
      traits: ['stubborn'],
      drives: ['deliver the sigil'],
      voice: 'Clipped, wary.',
    },
    {
      id: 'c2',
      name: 'Mora',
      status: 'active',
      description: 'A smuggler who knows the marsh paths.',
      traits: [],
      drives: [],
      voice: 'Low and amused.',
    },
  ],
  closeFactions: [
    {
      id: 'f1',
      name: 'The Reed Runners',
      status: 'active',
      description: 'Smugglers of the marsh.',
      standing: 'Tolerated by the keep’s steward.',
      agenda: ['keep the marsh paths secret'],
    },
  ],
  closeSoftCaps: { traits: 8, drives: 6, agenda: 4 },
  closeWritesSoFar: '- update_lore The drowned sigils (lo1): body',
}
const CLOSE_IDENTITY_NO_LEAD: Context = {
  ...CLOSE_PROSE_NO_LEAD,
  closeCharacters: [
    {
      id: 'c1',
      name: 'Ilse Varga',
      status: 'active',
      description: 'A harbour clerk who misses nothing.',
      traits: ['patient'],
      drives: [],
      voice: '',
    },
    {
      id: 'c2',
      name: 'Orrin',
      status: 'active',
      description: 'A net-mender who works the pier at dawn.',
      traits: [],
      drives: [],
      voice: '',
    },
  ],
  closeFactions: [],
  closeSoftCaps: { traits: 8, drives: 6, agenda: 4 },
  closeWritesSoFar: '',
}

const CLOSE_THREADS_WITH_LEAD: Context = {
  ...CLOSE_PROSE_WITH_LEAD,
  closeThreads: [
    {
      id: 'th1',
      title: 'Deliver the sigil',
      description: 'To the keep’s last steward.',
      status: 'active',
      injectionMode: 'auto',
    },
    {
      id: 'th2',
      title: 'The guild’s hunters',
      description: '',
      status: 'pending',
      injectionMode: 'always',
    },
  ],
  closeWritesSoFar: '- update_character Kael (c1): state.traits',
}
const CLOSE_THREADS_NO_LEAD: Context = {
  ...CLOSE_PROSE_NO_LEAD,
  closeThreads: [
    {
      id: 'th1',
      title: 'Who drowned the sailor',
      description: '',
      status: 'active',
      injectionMode: 'auto',
    },
  ],
  closeWritesSoFar: '',
}

const CLOSE_UPKEEP_WITH_LEAD: Context = {
  ...CLOSE_PROSE_WITH_LEAD,
  closeUpkeepRows: [
    {
      id: 'l1',
      kind: 'location',
      name: 'The Drowned Keep',
      status: 'active',
      description: 'A fortress half sunk into the marsh.',
      keywords: ['the keep'],
      condition: 'Flooded to the second stair.',
      placement: 'The Marsh',
      inScene: true,
    },
    {
      id: 'i1',
      kind: 'item',
      name: 'The sigil',
      status: 'active',
      description: '',
      keywords: [],
      condition: '',
      placement: '',
      inScene: false,
    },
  ],
  closeUpkeepHappenings: [{ id: 'hp1', title: 'The ford ambush' }],
  closeWritesSoFar: '',
}
const CLOSE_UPKEEP_NO_LEAD: Context = {
  ...CLOSE_PROSE_NO_LEAD,
  closeUpkeepRows: [
    {
      id: 'l1',
      kind: 'location',
      name: 'Gullhaven harbour',
      status: 'active',
      description: '',
      keywords: [],
      condition: '',
      placement: 'top level',
      inScene: true,
    },
  ],
  closeUpkeepHappenings: [],
  closeWritesSoFar: '',
}

const CLOSE_LIFECYCLE_WITH_LEAD: Context = {
  ...CLOSE_PROSE_WITH_LEAD,
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
      id: 'c2',
      kind: 'character',
      name: 'Mora',
      status: 'active',
      retiredReason: '',
      collision: '',
    },
    {
      id: 'i1',
      kind: 'item',
      name: 'The sigil',
      status: 'active',
      retiredReason: '',
      collision: '',
    },
  ],
  closeWritesSoFar: '- update_thread Deliver the sigil (th1): description',
}
const CLOSE_LIFECYCLE_NO_LEAD: Context = {
  ...CLOSE_PROSE_NO_LEAD,
  closeLifecycleRows: [
    {
      id: 'c1',
      kind: 'character',
      name: 'Ilse Varga',
      status: 'active',
      retiredReason: '',
      collision: '',
    },
    {
      id: 'c2',
      kind: 'character',
      name: 'Orrin',
      status: 'active',
      retiredReason: '',
      collision: '',
    },
  ],
  closeWritesSoFar: '',
}

// Happenings and Awareness show no turns: their system half is the shared instructions alone.
const CLOSE_HAPPENINGS_WITH_LEAD: Context = {
  ...CLOSE_STORY_WITH_LEAD,
  closeHappeningClusters: [
    [
      {
        id: 'hp1',
        title: 'The sigil lost in the flood',
        description: 'The current tears the sigil from Kael’s hand as he wades toward the keep.',
        cast: [{ id: 'c1', name: 'Kael' }],
        knownBy: [{ id: 'c1', name: 'Kael' }],
        turn: 't3',
        commonKnowledge: false,
      },
      {
        id: 'hp2',
        title: 'Kael dives for the sigil',
        description:
          'Kael dives after the sigil and comes up with only weed, while Mora watches from the stair.',
        cast: [
          { id: 'c1', name: 'Kael' },
          { id: 'c2', name: 'Mora' },
        ],
        knownBy: [
          { id: 'c1', name: 'Kael' },
          { id: 'c2', name: 'Mora' },
        ],
        turn: 't5',
        commonKnowledge: false,
      },
    ],
  ],
  closeWritesSoFar: '',
}
const CLOSE_HAPPENINGS_NO_LEAD: Context = {
  ...CLOSE_STORY_NO_LEAD,
  closeHappeningClusters: [
    [
      {
        id: 'hp1',
        title: 'A body under the pier',
        description:
          'Orrin finds a drowned sailor under the pier at dawn, a gull feather in his collar.',
        cast: [{ id: 'c2', name: 'Orrin' }],
        knownBy: [{ id: 'c2', name: 'Orrin' }],
        turn: 't3',
        commonKnowledge: false,
      },
      {
        id: 'hp2',
        title: 'The sailor found at dawn',
        description: '',
        cast: [{ id: 'c2', name: 'Orrin' }],
        knownBy: [],
        turn: 't3',
        commonKnowledge: true,
      },
    ],
  ],
  closeWritesSoFar: '- update_thread Who drowned the sailor (th1): description',
}

const CLOSE_AWARENESS_WITH_LEAD: Context = {
  ...CLOSE_STORY_WITH_LEAD,
  closeAwarenessRows: [
    {
      happening: { id: 'hp1', title: 'The sigil lost in the flood' },
      rows: [
        {
          id: 'aw1',
          character: { id: 'c1', name: 'Kael' },
          decayResistance: 0.4,
          source: 'it happened to him',
          learnedAt: 't3',
          list: 'chapter',
        },
        {
          id: 'aw2',
          character: { id: 'c2', name: 'Mora' },
          decayResistance: null,
          source: '',
          learnedAt: '',
          list: 'frequent',
        },
      ],
    },
  ],
  closeChapterSummary:
    'Kael wades toward the Drowned Keep and loses the sigil to the current; Mora watches from the stair.',
  closeChapterTurns: { first: 't1', last: 't5' },
  closeWritesSoFar: '- merge_happenings The sigil lost in the flood (hp1): kept hp1',
}
const CLOSE_AWARENESS_NO_LEAD: Context = {
  ...CLOSE_STORY_NO_LEAD,
  closeAwarenessRows: [
    {
      happening: { id: 'hp1', title: 'A body under the pier' },
      rows: [
        {
          id: 'aw1',
          character: { id: 'c2', name: 'Orrin' },
          decayResistance: 0.6,
          source: 'found the body',
          learnedAt: 't3',
          list: 'chapter',
        },
      ],
    },
  ],
  closeChapterSummary: '',
  closeChapterTurns: { first: 't1', last: 't5' },
  closeWritesSoFar: '',
}

/** A template, its context with a lead and with none, and what each render must show of it. */
type Case = [TemplateId, Context, Context, [string, string]]

const CASES: Case[] = [
  [
    TEMPLATE_IDS.perTurnNarrative,
    GENERATION_WITH_LEAD,
    GENERATION_NO_LEAD,
    [LEAD_LAST, NO_LEAD_LAST],
  ],
  [
    TEMPLATE_IDS.piggybackFallbackClassifier,
    GENERATION_WITH_LEAD,
    GENERATION_NO_LEAD,
    [LEAD_LAST, NO_LEAD_LAST],
  ],
  [
    TEMPLATE_IDS.suggestionRefresh,
    GENERATION_WITH_LEAD,
    GENERATION_NO_LEAD,
    [LEAD_LAST, NO_LEAD_LAST],
  ],
  [
    TEMPLATE_IDS.periodicClassifier,
    PERIODIC_WITH_LEAD,
    PERIODIC_NO_LEAD,
    [LEAD_LAST, NO_LEAD_LAST],
  ],
  [
    TEMPLATE_IDS.chapterMetadata,
    CHAPTER_METADATA_WITH_LEAD,
    CHAPTER_METADATA_NO_LEAD,
    [LEAD_LAST, NO_LEAD_LAST],
  ],
  [
    TEMPLATE_IDS.chapterMetadataPart,
    CHAPTER_PART_WITH_LEAD,
    CHAPTER_PART_NO_LEAD,
    [LEAD_PART_LAST, NO_LEAD_PART_LAST],
  ],
  [
    TEMPLATE_IDS.chapterMetadataMerge,
    CHAPTER_MERGE_WITH_LEAD,
    CHAPTER_MERGE_NO_LEAD,
    ['You dive for the sigil and come up with weed', 'keeps watch over the body'],
  ],
  [TEMPLATE_IDS.closeLore, CLOSE_LORE_WITH_LEAD, CLOSE_LORE_NO_LEAD, [LEAD_LAST, NO_LEAD_LAST]],
  [
    TEMPLATE_IDS.closeIdentity,
    CLOSE_IDENTITY_WITH_LEAD,
    CLOSE_IDENTITY_NO_LEAD,
    [LEAD_LAST, NO_LEAD_LAST],
  ],
  [
    TEMPLATE_IDS.closeThreads,
    CLOSE_THREADS_WITH_LEAD,
    CLOSE_THREADS_NO_LEAD,
    [LEAD_LAST, NO_LEAD_LAST],
  ],
  [
    TEMPLATE_IDS.closeUpkeep,
    CLOSE_UPKEEP_WITH_LEAD,
    CLOSE_UPKEEP_NO_LEAD,
    [LEAD_LAST, NO_LEAD_LAST],
  ],
  [
    TEMPLATE_IDS.closeLifecycle,
    CLOSE_LIFECYCLE_WITH_LEAD,
    CLOSE_LIFECYCLE_NO_LEAD,
    [LEAD_LAST, NO_LEAD_LAST],
  ],
  [
    TEMPLATE_IDS.closeHappenings,
    CLOSE_HAPPENINGS_WITH_LEAD,
    CLOSE_HAPPENINGS_NO_LEAD,
    ['hp2: Kael dives for the sigil', 'hp2: The sailor found at dawn (common knowledge)'],
  ],
  [
    TEMPLATE_IDS.closeAwareness,
    CLOSE_AWARENESS_WITH_LEAD,
    CLOSE_AWARENESS_NO_LEAD,
    ['aw1: Kael (c1), pin 0.4', 'aw1: Orrin (c2), pin 0.6'],
  ],
]

// A variable the context leaves out renders blank, and would hide a change behind it.
function expectComplete(templateId: TemplateId, context: Context, shown: string): void {
  expect([...templateReads(templateId)].filter((name) => !(name in context))).toEqual([])
  const { system, user } = renderTemplate(templateId, context)
  expect(`${system}\n${user}`).toContain(shown)
  expect(`${system}\n${user}`).not.toContain(CLAUSE)
}

describe.each(CASES)('%s', (templateId, withLead, noLead, [showsWithLead, showsNoLead]) => {
  it('with a lead', () => {
    expect(renderTemplate(templateId, withLead)).toMatchSnapshot()
  })

  it('with no lead', () => {
    expect(renderTemplate(templateId, noLead)).toMatchSnapshot()
  })

  it('with a lead: sets every variable it reads, shows its story and holds no clause', () => {
    expectComplete(templateId, withLead, showsWithLead)
  })

  it('with no lead: sets every variable it reads, shows its story and holds no clause', () => {
    expectComplete(templateId, noLead, showsNoLead)
  })
})
