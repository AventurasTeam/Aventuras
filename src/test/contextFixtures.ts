/**
 * Shared typed fixtures for mapper and shim unit tests (Phase 8).
 *
 * Every export is typed against the exact interfaces consumed by the mapper
 * functions — no stringly-typed UI preview data is used here.
 *
 * Import path from src/lib/services/context/ tests:
 *   import { ... } from '../../test/contextFixtures'
 */

import type { ContextResult, WorldState } from '$lib/services/ai/generation/EntryInjector'
import type {
  EntryRetrievalResult,
  RetrievedEntry,
} from '$lib/services/ai/retrieval/EntryRetrievalService'
import type { TimelineFillResult } from '$lib/services/ai/retrieval/TimelineFillService'
import type {
  Chapter,
  StoryEntry,
  Entry,
  CharacterEntryState,
  Character,
  StoryBeat,
} from '$lib/types'

// ---------------------------------------------------------------------------
// contextResult: ContextResult
// ---------------------------------------------------------------------------

/**
 * Main input fixture for worldStateMapper tests.
 *
 * tier1:
 *   - character 'Aria' with full visualDescriptors (companion, brave+loyal)
 *   - location 'The Crossroads Inn' with metadata.current=true  ← makes currentLocationObject non-null
 *   - item 'Iron Dagger' with quantity=1, equipped=true
 *   - storyBeat 'Find the Lost Key' with type='quest', status='active'
 * tier2:
 *   - character 'Lord Malachar' (goes into worldStateCharacters as tier-2)
 *   - item 'Ancient Tome' (no equipped/quantity defaults → goes into worldStateRelevantItems)
 *   - storyBeat 'The Dark Prophecy' (goes into worldStateRelatedBeats)
 * tier3:
 *   - location 'Dark Forest' (non-current, tier-3)
 */
export const contextResult: ContextResult = {
  tier1: [
    {
      type: 'character',
      id: 'char-aria',
      name: 'Aria',
      description: 'A skilled archer with a steady aim.',
      tier: 1,
      priority: 90,
      metadata: {
        relationship: 'companion',
        traits: ['brave', 'loyal'],
        visualDescriptors: {
          face: 'Sharp cheekbones, warm olive skin, determined expression',
          hair: 'Dark brown, shoulder-length, loosely braided',
          eyes: 'Amber, slightly almond-shaped',
          build: 'Lean and athletic, medium height',
          clothing: 'Worn leather travelling gear, forest-green cloak',
          accessories: 'Quiver of arrows, silver ring on left hand',
          distinguishing: 'Small scar above right eyebrow',
        },
      },
    },
    {
      type: 'location',
      id: 'loc-inn',
      name: 'The Crossroads Inn',
      description: 'A weathered tavern at a busy crossroads.',
      tier: 1,
      priority: 100,
      metadata: {
        current: true,
      },
    },
    {
      type: 'item',
      id: 'item-dagger',
      name: 'Iron Dagger',
      description: 'A simple but reliable iron blade.',
      tier: 1,
      priority: 70,
      metadata: {
        quantity: 1,
        equipped: true,
      },
    },
    {
      type: 'storyBeat',
      id: 'beat-key',
      name: 'Find the Lost Key',
      description: 'Retrieve the key to the sealed vault.',
      tier: 1,
      priority: 80,
      metadata: {
        type: 'quest',
        status: 'active',
      },
    },
  ],
  tier2: [
    {
      type: 'character',
      id: 'char-malachar',
      name: 'Lord Malachar',
      description: 'A sinister nobleman with hidden ambitions.',
      tier: 2,
      priority: 60,
      metadata: {
        relationship: 'antagonist',
        traits: ['cunning', 'ruthless'],
        visualDescriptors: {},
      },
    },
    {
      type: 'item',
      id: 'item-tome',
      name: 'Ancient Tome',
      description: 'A crumbling book filled with arcane diagrams.',
      tier: 2,
      priority: 40,
      metadata: {},
    },
    {
      type: 'storyBeat',
      id: 'beat-prophecy',
      name: 'The Dark Prophecy',
      description: "A foreboding prophecy about the land's fate.",
      tier: 2,
      priority: 45,
      metadata: {
        type: 'revelation',
        status: 'active',
      },
    },
  ],
  tier3: [
    {
      type: 'location',
      id: 'loc-forest',
      name: 'Dark Forest',
      description: 'A dense, foreboding woodland to the north.',
      tier: 3,
      priority: 30,
      metadata: {
        current: false,
      },
    },
  ],
  all: [],
}

// Populate all after tier arrays are defined
;(contextResult as { all: typeof contextResult.tier1 }).all = [
  ...contextResult.tier1,
  ...contextResult.tier2,
  ...contextResult.tier3,
]

// ---------------------------------------------------------------------------
// emptyWorldState: WorldState
// ---------------------------------------------------------------------------

/** Minimal WorldState for mapper tests that don't need populated world data. */
export const emptyWorldState: WorldState = {
  characters: [],
  locations: [],
  items: [],
  storyBeats: [],
}

// ---------------------------------------------------------------------------
// entryRetrievalResult: EntryRetrievalResult
// ---------------------------------------------------------------------------

/**
 * Input fixture for lorebookMapper tests.
 *
 * Two RetrievedEntry objects:
 *   1. faction entry 'The Shadow Guild', tier 2
 *   2. character entry 'Lord Malachar', tier 1 (isPresent=true)
 */

const factionEntry: Entry = {
  id: 'entry-shadow-guild',
  storyId: 'story-1',
  name: 'The Shadow Guild',
  type: 'faction',
  description: 'A secretive thieves organization operating in the shadows of major cities.',
  hiddenInfo: null,
  aliases: [],
  state: { type: 'faction' } as any, // FactionEntryState — 'as any' to satisfy union without full state object
  adventureState: null,
  creativeState: null,
  injection: { mode: 'keyword', keywords: [], priority: 0 },
  firstMentioned: null,
  lastMentioned: null,
  mentionCount: 0,
  createdBy: 'user',
  createdAt: 0,
  updatedAt: 0,
  loreManagementBlacklisted: false,
  branchId: null,
}

const malacharEntryState: CharacterEntryState = {
  type: 'character',
  isPresent: true,
  lastSeenLocation: null,
  currentDisposition: 'hostile',
  relationship: {
    level: -50,
    status: 'enemy',
    history: [],
  },
  knownFacts: [],
  revealedSecrets: [],
} satisfies CharacterEntryState

const characterEntry: Entry = {
  id: 'entry-malachar',
  storyId: 'story-1',
  name: 'Lord Malachar',
  type: 'character',
  description: 'A sinister nobleman pulling strings from the shadows.',
  hiddenInfo: null,
  aliases: [],
  state: malacharEntryState,
  adventureState: null,
  creativeState: null,
  injection: { mode: 'keyword', keywords: [], priority: 0 },
  firstMentioned: null,
  lastMentioned: null,
  mentionCount: 0,
  createdBy: 'user',
  createdAt: 0,
  updatedAt: 0,
  loreManagementBlacklisted: false,
  branchId: null,
}

const factionRetrievedEntry: RetrievedEntry = {
  entry: factionEntry,
  tier: 2,
  priority: 70,
}

const characterRetrievedEntry: RetrievedEntry = {
  entry: characterEntry,
  tier: 1,
  priority: 85,
}

export const entryRetrievalResult: EntryRetrievalResult = {
  tier1: [characterRetrievedEntry],
  tier2: [factionRetrievedEntry],
  tier3: [],
  all: [characterRetrievedEntry, factionRetrievedEntry],
}

// ---------------------------------------------------------------------------
// rawChapters: Chapter[]
// ---------------------------------------------------------------------------

/**
 * Input fixture for chapterMapper tests.
 *
 * Two chapters:
 *   1. Chapter 1 — fully populated including title, characters, locations, emotionalTone
 *   2. Chapter 2 — title=null, no characters/locations, emotionalTone=null
 *      (exercises the `?? ''` null-coalescing path in chapterMapper)
 */
export const rawChapters: Chapter[] = [
  {
    id: 'ch-1',
    storyId: 'story-1',
    number: 1,
    title: 'The Beginning',
    startEntryId: 'entry-1',
    endEntryId: 'entry-10',
    entryCount: 10,
    summary: 'Things began.',
    startTime: { years: 0, days: 1, hours: 8, minutes: 0 },
    endTime: { years: 0, days: 1, hours: 20, minutes: 0 },
    keywords: ['inn', 'crossroads'],
    characters: ['Aria'],
    locations: ['The Crossroads Inn'],
    plotThreads: [],
    emotionalTone: 'hopeful',
    branchId: null,
    createdAt: 0,
  },
  {
    id: 'ch-2',
    storyId: 'story-1',
    number: 2,
    title: null,
    startEntryId: 'entry-11',
    endEntryId: 'entry-20',
    entryCount: 10,
    summary: 'Events transpired.',
    startTime: null,
    endTime: null,
    keywords: [],
    characters: [],
    locations: [],
    plotThreads: [],
    emotionalTone: null,
    branchId: null,
    createdAt: 0,
  },
]

// ---------------------------------------------------------------------------
// timelineFillResult: TimelineFillResult
// ---------------------------------------------------------------------------

/**
 * Input fixture for chapterMapper tests that exercise timelineFill output.
 * One query result covering chapters 1 and 2.
 */
export const timelineFillResult: TimelineFillResult = {
  queries: [],
  responses: [
    {
      query: 'What happened between chapters?',
      answer: 'A journey occurred.',
      chapterNumbers: [1, 2],
    },
  ],
}

// ---------------------------------------------------------------------------
// rawStoryEntries: StoryEntry[]
// ---------------------------------------------------------------------------

/**
 * Input fixture for storyEntryMapper tests.
 *
 * Three entries:
 *   1. narration — plain text
 *   2. user_action — plain text
 *   3. narration — contains a <pic> tag (exercises the stripPicTags path)
 *      Content after stripping: 'A dragon appeared.'
 */
export const rawStoryEntries: StoryEntry[] = [
  {
    id: 'se-1',
    storyId: 'story-1',
    type: 'narration',
    content: 'The torches flickered.',
    parentId: null,
    position: 1,
    createdAt: 0,
    metadata: null,
    branchId: null,
  },
  {
    id: 'se-2',
    storyId: 'story-1',
    type: 'user_action',
    content: 'I draw my sword.',
    parentId: null,
    position: 2,
    createdAt: 0,
    metadata: null,
    branchId: null,
  },
  {
    id: 'se-3',
    storyId: 'story-1',
    type: 'narration',
    content: '<pic src="dragon.png">A dragon appeared.</pic>',
    parentId: null,
    position: 3,
    createdAt: 0,
    metadata: null,
    branchId: null,
  },
]

// ---------------------------------------------------------------------------
// rawCharacters: Character[]
// ---------------------------------------------------------------------------

/**
 * Input fixture for classifierMapper and imageMapper tests.
 *
 * Two characters:
 *   1. 'Aria' — fully populated with all VisualDescriptors fields
 *   2. 'Unknown Traveler' — minimal, empty visualDescriptors (exercises empty-array fallback)
 */
export const rawCharacters: Character[] = [
  {
    id: 'char-aria',
    storyId: 'story-1',
    name: 'Aria',
    description: 'A skilled archer with a steady aim.',
    relationship: 'companion',
    traits: ['brave', 'loyal'],
    visualDescriptors: {
      face: 'Sharp cheekbones',
      hair: 'Dark brown braid',
      eyes: 'Amber',
      build: 'Lean and athletic',
      clothing: 'Leather travelling gear',
      accessories: 'Quiver of arrows',
      distinguishing: 'Scar above right eyebrow',
    },
    portrait: null,
    status: 'active',
    metadata: null,
    branchId: null,
  },
  {
    id: 'char-minimal',
    storyId: 'story-1',
    name: 'Unknown Traveler',
    description: null,
    relationship: null,
    traits: [],
    visualDescriptors: {},
    portrait: null,
    status: 'inactive',
    metadata: null,
    branchId: null,
  },
]

// ---------------------------------------------------------------------------
// rawStoryBeats: StoryBeat[]
// ---------------------------------------------------------------------------

/**
 * Input fixture for classifierMapper and imageMapper tests.
 *
 * Two beats:
 *   1. 'Find the Lost Key' — fully populated quest beat
 *   2. 'The Darkness' — minimal, description=null (exercises ?? '' path)
 */
export const rawStoryBeats: StoryBeat[] = [
  {
    id: 'beat-key',
    storyId: 'story-1',
    title: 'Find the Lost Key',
    description: 'Retrieve the key to the sealed vault.',
    type: 'quest',
    status: 'active',
    triggeredAt: null,
    metadata: null,
    branchId: null,
  },
  {
    id: 'beat-minimal',
    storyId: 'story-1',
    title: 'The Darkness',
    description: null,
    type: 'revelation',
    status: 'pending',
    triggeredAt: null,
    metadata: null,
    branchId: null,
  },
]
