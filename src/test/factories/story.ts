import type {
  Story,
  StorySettings,
  Character,
  Location,
  Item,
  StoryBeat,
  StoryEntry,
  Entry,
  Chapter,
  EntryInjection,
  CharacterEntryState,
  VisualDescriptors,
} from '$lib/types'

export function buildStory(overrides: Partial<Story> = {}): Story {
  const now = Date.now()
  const defaultSettings: StorySettings = {
    pov: 'second',
    tense: 'past',
    imageGenerationMode: 'none',
    backgroundImagesEnabled: false,
  }
  return {
    id: crypto.randomUUID(),
    title: 'Test Story',
    description: null,
    genre: null,
    templateId: null,
    mode: 'adventure',
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings,
    memoryConfig: null,
    retryState: null,
    styleReviewState: null,
    timeTracker: null,
    currentBranchId: null,
    currentBgImage: null,
    ...overrides,
  }
}

export function buildCharacter(overrides: Partial<Character> = {}): Character {
  const defaultVisualDescriptors: VisualDescriptors = {}
  return {
    id: crypto.randomUUID(),
    storyId: crypto.randomUUID(),
    name: 'Test Character',
    description: null,
    relationship: null,
    traits: [],
    visualDescriptors: defaultVisualDescriptors,
    portrait: null,
    status: 'active',
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

export function buildLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: crypto.randomUUID(),
    storyId: crypto.randomUUID(),
    name: 'Test Location',
    description: null,
    visited: false,
    current: false,
    connections: [],
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

export function buildItem(overrides: Partial<Item> = {}): Item {
  return {
    id: crypto.randomUUID(),
    storyId: crypto.randomUUID(),
    name: 'Test Item',
    description: null,
    quantity: 1,
    equipped: false,
    location: 'inventory',
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

export function buildStoryBeat(overrides: Partial<StoryBeat> = {}): StoryBeat {
  return {
    id: crypto.randomUUID(),
    storyId: crypto.randomUUID(),
    title: 'Test Beat',
    description: null,
    type: 'event',
    status: 'pending',
    triggeredAt: null,
    resolvedAt: null,
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

export function buildEntry(overrides: Partial<StoryEntry> = {}): StoryEntry {
  return {
    id: crypto.randomUUID(),
    storyId: crypto.randomUUID(),
    type: 'narration',
    content: 'Test entry content.',
    parentId: null,
    position: 0,
    createdAt: Date.now(),
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

// Lorebook entry params: accepts Partial<Entry> plus an optional `keywords` shorthand
// that maps to injection.keywords (since Entry uses injection.keywords, not a top-level field)
type LorebookEntryParams = Partial<Omit<Entry, 'injection'>> & {
  keywords?: string[]
  injection?: Partial<EntryInjection>
}

export function buildLorebookEntry(overrides: LorebookEntryParams = {}): Entry {
  const { keywords, injection: injectionOverride, ...entryOverrides } = overrides

  const defaultState: CharacterEntryState = {
    type: 'character',
    isPresent: false,
    lastSeenLocation: null,
    currentDisposition: null,
    relationship: {
      level: 0,
      status: 'neutral',
      history: [],
    },
    knownFacts: [],
    revealedSecrets: [],
  }

  const defaultInjection: EntryInjection = {
    mode: 'keyword',
    keywords: keywords ?? [],
    priority: 0,
  }

  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    storyId: crypto.randomUUID(),
    name: 'Test Lore Entry',
    type: 'character',
    description: 'A test lorebook entry.',
    hiddenInfo: null,
    aliases: [],
    state: defaultState,
    adventureState: null,
    creativeState: null,
    injection: injectionOverride ? { ...defaultInjection, ...injectionOverride } : defaultInjection,
    firstMentioned: null,
    lastMentioned: null,
    mentionCount: 0,
    createdBy: 'user',
    createdAt: now,
    updatedAt: now,
    loreManagementBlacklisted: false,
    branchId: null,
    ...entryOverrides,
  }
}

export function buildChapter(overrides: Partial<Chapter> = {}): Chapter {
  const entryId = crypto.randomUUID()
  return {
    id: crypto.randomUUID(),
    storyId: crypto.randomUUID(),
    number: 1,
    title: null,
    startEntryId: entryId,
    endEntryId: entryId,
    entryCount: 0,
    summary: '',
    startTime: null,
    endTime: null,
    keywords: [],
    characters: [],
    locations: [],
    plotThreads: [],
    emotionalTone: null,
    branchId: null,
    createdAt: Date.now(),
    ...overrides,
  }
}
