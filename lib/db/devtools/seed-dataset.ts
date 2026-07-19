import type { SQLiteTable } from 'drizzle-orm/sqlite-core'

import { BUNDLED_PACK_ID } from '@/lib/prompts'

import {
  appearanceSchema,
  modelProfileSchema,
  providerInstanceSchema,
} from '../app-settings/app-settings-schema'
import type { EntityState } from '../entities/entities-types'
import { entityStateSchemaForKind } from '../entities/entity-state-schema'
import {
  appSettings,
  assets,
  branchEraFlips,
  branches,
  chapters,
  characterRelationships,
  deltas,
  entities,
  entryAssets,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  pipelineRuns,
  stories,
  storyEntries,
  threads,
  translations,
  vaultCalendars,
} from '../schema'
import { storyDefinitionSchema, storySettingsSchema } from '../stories/story-config-schema'
import type { StoryDefinition, StorySettings } from '../stories/story-config-schema'
import { entryMetadataSchema } from '../story-entries/entry-metadata'
import type { EntryMetadata } from '../story-entries/entry-metadata'
import type {
  NewAppSettings,
  NewAsset,
  NewBranch,
  NewBranchEraFlip,
  NewChapter,
  NewCharacterRelationship,
  NewDelta,
  NewEntity,
  NewEntryAsset,
  NewHappening,
  NewHappeningAwareness,
  NewHappeningInvolvement,
  NewLore,
  NewPipelineRun,
  NewStory,
  NewStoryEntry,
  NewThread,
  NewTranslation,
  NewVaultCalendar,
} from '../types'

// A seed step is one table's worth of rows; the runner inserts steps in array
// order (FK-correct) and wipes beforehand. Rows are type-checked per table at
// construction via step(), then erased so the heterogeneous list is one type.
export type SeedStep = { name: string; table: SQLiteTable; rows: readonly unknown[] }

function step<T extends SQLiteTable>(
  name: string,
  table: T,
  rows: readonly T['$inferInsert'][],
): SeedStep {
  return { name, table, rows }
}

// Fixed epoch so reseeds are byte-stable and createdAt order tracks narrative
// order: 2026-01-01T00:00:00Z. Timestamps below are BASE + deterministic offsets.
const BASE = 1_767_225_600_000
const MIN = 60_000
const DAY = 86_400_000

// ---------------------------------------------------------------------------
// Hero story — a full graph that exercises every domain table.
// ---------------------------------------------------------------------------

const HERO = 'story_hero'
const MAIN = 'branch_hero_main'
const FORK = 'branch_hero_fork'

const CAL = 'cal_default'

// Entities (branch: MAIN). IDs are referenced across state, scenes, relationships,
// happenings and awareness, so they live in one place.
const ID = {
  kael: 'char_kael',
  mira: 'char_mira',
  vorne: 'char_vorne',
  sage: 'char_sage',
  hollow: 'loc_hollow',
  market: 'loc_market',
  keep: 'loc_keep',
  blade: 'item_blade',
  amulet: 'item_amulet',
  key: 'item_key',
  watch: 'fac_watch',
  syndicate: 'fac_syndicate',
} as const

function entryId(prefix: string, i: number): string {
  return `e_${prefix}_${String(i).padStart(4, '0')}`
}

// Validate-or-throw: build-time guard that every JSON payload satisfies its Zod
// schema. drizzle-seed's random JSON can't do this; hand-authoring + parse can.
function validState(
  kind: Parameters<typeof entityStateSchemaForKind>[0],
  state: EntityState,
): EntityState {
  return entityStateSchemaForKind(kind).parse(state) as EntityState
}

function definition(input: {
  mode: 'adventure' | 'creative'
  narration: 'first' | 'second' | 'third'
  leadEntityId: string | null
  genre: string
  tone: string
  setting: string
}): StoryDefinition {
  return storyDefinitionSchema.parse({
    mode: input.mode,
    leadEntityId: input.leadEntityId,
    narration: input.narration,
    genre: { label: input.genre, promptBody: `Write in the ${input.genre} tradition.` },
    tone: { label: input.tone, promptBody: `Keep a ${input.tone} tone.` },
    setting: input.setting,
    calendarSystemId: CAL,
    worldTimeOrigin: { year: 1247, day: 1 },
  })
}

function settings(overrides: Partial<StorySettings> = {}): StorySettings {
  return storySettingsSchema.parse({
    classifierCadence: 4,
    piggybackMode: 'on',
    embeddingBackend: 'local',
    embedding_model_id: 'bge-small-en',
    retrievalBudgets: { entities: 8, lore: 6, happenings: 6, threads: 4, chapters: 3 },
    composerModesEnabled: true,
    composerWrapPov: 'third',
    suggestionsEnabled: true,
    suggestionCategories: [
      {
        id: 'act',
        label: 'Act',
        promptHint: 'Take a physical action',
        color: '#4f8',
        enabled: true,
        order: 0,
      },
      {
        id: 'speak',
        label: 'Speak',
        promptHint: 'Say something',
        color: '#48f',
        enabled: true,
        order: 1,
      },
    ],
    translation: {
      enabled: true,
      targetLanguage: 'es',
      granularToggles: {
        narrative: true,
        entityNames: false,
        entityDescriptions: true,
        lore: true,
        threads: false,
        happenings: false,
        chapterMeta: true,
      },
    },
    models: {},
    activePackId: BUNDLED_PACK_ID,
    packVariables: {},
    ...overrides,
  })
}

// ---- Hero entries + chapters --------------------------------------------------

const N_HERO = 72
const CHAP1_END = 30
const CHAP2_END = 58

const REPLY_LINES = [
  'The lantern gutters as you press deeper into the Hollow, stone sweating cold beneath your palm.',
  'A figure peels away from the crowd and does not look back. Mira touches your arm in warning.',
  'Rain finds the gaps in the rooftops. Below, the market keeps its uneasy bargain with the dark.',
  'Vorne is waiting where the alley narrows, and his smile is the kind that has already counted your steps.',
  'The amulet warms against your chest, a pulse that answers something you cannot yet see.',
  'Watchmen move in pairs tonight. Whatever burned in the square has them spooked.',
  'Old stone remembers older oaths. The keep leans over the river like a held breath.',
  'You weigh the key in your hand. It is lighter than a promise and heavier than a grave.',
]
const REPLY_BEATS = [
  'You decide quickly; hesitation costs more than mistakes here.',
  'Somewhere a bell counts the hour and gets it wrong.',
  'Mira says nothing, which is how she says the most.',
  'The Veil thins, and for a heartbeat the city wears a second face.',
]
const ACTION_LINES = [
  'I draw the blade and listen for footsteps.',
  'I ask Mira what she saw in the market.',
  'I follow the figure into the alley, keeping to the shadow.',
  'I press the amulet flat and try to quiet its pulse.',
  'I bargain with the watchman for a name.',
  'I climb toward the keep before the gate-lamps are lit.',
]
const SYSTEM_LINES = [
  'A new era turns over the Hollow.',
  'The chapter draws to its close.',
  'Time slips forward; the watch changes.',
]
const OPENING_TEXT =
  'You arrive in Veil’s Hollow with an amulet you cannot explain and a name the Syndicate would kill to bury. The rain has not stopped in nine days. Neither, it seems, has the city’s appetite for you.'

const SCENE_POOL = [ID.kael, ID.mira, ID.vorne, ID.sage]
const LOC_POOL = [ID.hollow, ID.market, ID.keep]

function heroKind(i: number): NewStoryEntry['kind'] {
  if (i === 1) return 'opening'
  if (i % 12 === 0) return 'system'
  return i % 2 === 0 ? 'user_action' : 'ai_reply'
}

function heroContent(i: number, kind: NewStoryEntry['kind']): string {
  if (kind === 'opening') return OPENING_TEXT
  if (kind === 'system') return SYSTEM_LINES[i % SYSTEM_LINES.length]
  if (kind === 'user_action') return `${ACTION_LINES[i % ACTION_LINES.length]}`
  return `${REPLY_LINES[i % REPLY_LINES.length]} ${REPLY_BEATS[i % REPLY_BEATS.length]}`
}

function heroChapterId(i: number): string | null {
  if (i <= CHAP1_END) return 'chap_hero_1'
  if (i <= CHAP2_END) return 'chap_hero_2'
  return null
}

function heroEntries(): NewStoryEntry[] {
  const rows: NewStoryEntry[] = []
  for (let i = 1; i <= N_HERO; i++) {
    const kind = heroKind(i)
    const worldTime = (i - 1) * 3
    const metadata: EntryMetadata = entryMetadataSchema.parse({
      sceneEntities: [SCENE_POOL[i % SCENE_POOL.length], SCENE_POOL[(i + 1) % SCENE_POOL.length]],
      currentLocationId: LOC_POOL[i % LOC_POOL.length],
      worldTime,
      ...(kind === 'ai_reply'
        ? { model: 'seed/narrative', tokens: { prompt: 800 + i, completion: 240 + i } }
        : {}),
    })
    rows.push({
      id: entryId('hero', i),
      branchId: MAIN,
      position: i,
      kind,
      content: heroContent(i, kind),
      chapterId: heroChapterId(i),
      metadata,
      createdAt: BASE + i * MIN,
    })
  }
  return rows
}

function forkEntries(): NewStoryEntry[] {
  const rows: NewStoryEntry[] = []
  for (let i = 1; i <= 12; i++) {
    const kind: NewStoryEntry['kind'] =
      i === 1 ? 'opening' : i % 2 === 0 ? 'user_action' : 'ai_reply'
    rows.push({
      id: entryId('fork', i),
      branchId: FORK,
      position: i,
      kind,
      content:
        i === 1
          ? 'You let the figure go. The alley swallows them, and the city tilts toward a different ending.'
          : heroContent(i + 3, kind),
      chapterId: null,
      metadata: entryMetadataSchema.parse({
        sceneEntities: [ID.kael, ID.mira],
        currentLocationId: ID.market,
        worldTime: 117 + i,
      }),
      createdAt: BASE + DAY + i * MIN,
    })
  }
  return rows
}

const heroChapters: NewChapter[] = [
  {
    id: 'chap_hero_1',
    branchId: MAIN,
    sequenceNumber: 1,
    title: 'Nine Days of Rain',
    summary:
      'Kael reaches Veil’s Hollow, draws the Syndicate’s notice, and meets Mira amid the market crowd.',
    theme: 'arrival and suspicion',
    keywords: ['hollow', 'amulet', 'syndicate', 'mira'],
    startEntryId: entryId('hero', 1),
    endEntryId: entryId('hero', CHAP1_END),
    tokenCount: 12400,
    closedAt: BASE + 6 * DAY,
    embeddingStale: 0,
    createdAt: BASE + 6 * DAY,
    updatedAt: BASE + 6 * DAY,
  },
  {
    id: 'chap_hero_2',
    branchId: MAIN,
    sequenceNumber: 2,
    title: 'The Keep Leans Closer',
    summary:
      'The market fire pulls the Watch into the open while Vorne presses a pact Kael cannot afford to refuse.',
    theme: 'pressure and pacts',
    keywords: ['watch', 'fire', 'vorne', 'keep'],
    startEntryId: entryId('hero', 31),
    endEntryId: entryId('hero', CHAP2_END),
    tokenCount: 13850,
    closedAt: BASE + 12 * DAY,
    embeddingStale: 1,
    createdAt: BASE + 12 * DAY,
    updatedAt: BASE + 12 * DAY,
  },
]

// ---- Hero entities ------------------------------------------------------------

const heroEntities: NewEntity[] = [
  {
    id: ID.kael,
    branchId: MAIN,
    kind: 'character',
    name: 'Kael',
    description: 'A courier turned fugitive, carrying an amulet that should not exist.',
    status: 'active',
    injectionMode: 'always',
    tags: ['protagonist', 'courier'],
    state: validState('character', {
      visual: { physique: 'lean', hair: 'dark', eyes: 'grey', attire: 'travel-worn leathers' },
      traits: ['resourceful', 'wary'],
      drives: ['understand the amulet', 'keep Mira out of the Syndicate’s reach'],
      voice: 'clipped, dry, slow to trust',
      current_location_id: ID.hollow,
      equipped_items: [ID.blade],
      inventory: [ID.amulet],
      faction_id: ID.watch,
      lastSeenAt: {
        entryId: entryId('hero', N_HERO),
        locationId: ID.hollow,
        worldTime: (N_HERO - 1) * 3,
      },
    }),
    createdAt: BASE,
    updatedAt: BASE + 12 * DAY,
  },
  {
    id: ID.mira,
    branchId: MAIN,
    kind: 'character',
    name: 'Mira',
    description: 'A market fixer who knows which doors in the Hollow are painted shut.',
    status: 'active',
    injectionMode: 'auto',
    tags: ['ally'],
    state: validState('character', {
      visual: { hair: 'copper', attire: 'a fixer’s many-pocketed coat' },
      traits: ['observant', 'guarded'],
      drives: ['protect her network', 'settle an old debt with Vorne'],
      current_location_id: ID.market,
      equipped_items: [],
      inventory: [],
      faction_id: null,
      lastSeenAt: { entryId: entryId('hero', 50), locationId: ID.market, worldTime: 147 },
    }),
    createdAt: BASE + MIN,
    updatedAt: BASE + 10 * DAY,
  },
  {
    id: ID.vorne,
    branchId: MAIN,
    kind: 'character',
    name: 'Vorne',
    description:
      'The Syndicate’s broker in the Hollow; collects names the way others collect coin.',
    status: 'active',
    injectionMode: 'always',
    tags: ['antagonist', 'syndicate'],
    state: validState('character', {
      visual: { attire: 'immaculate, out of place in the rain' },
      traits: ['patient', 'merciless'],
      drives: ['seize the amulet', 'rule the Veil through fear'],
      current_location_id: ID.keep,
      equipped_items: [],
      inventory: [],
      faction_id: ID.syndicate,
      lastSeenAt: { entryId: entryId('hero', 48), locationId: ID.keep, worldTime: 141 },
    }),
    createdAt: BASE + 2 * MIN,
    updatedAt: BASE + 11 * DAY,
  },
  {
    id: ID.sage,
    branchId: MAIN,
    kind: 'character',
    name: 'The Ashen Sage',
    description: 'A half-remembered mentor; the Watch insists they died years ago.',
    status: 'staged',
    injectionMode: 'disabled',
    tags: ['mystery'],
    state: validState('character', {
      visual: {},
      traits: ['cryptic'],
      drives: ['atone for an old betrayal'],
      current_location_id: null,
      equipped_items: [],
      inventory: [],
      faction_id: null,
      lastSeenAt: null,
    }),
    createdAt: BASE + 3 * MIN,
    updatedAt: BASE + 3 * MIN,
  },
  {
    id: ID.hollow,
    branchId: MAIN,
    kind: 'location',
    name: 'Veil’s Hollow',
    description: 'A rain-drowned city built over something the Veil keeps trying to forget.',
    status: 'active',
    injectionMode: 'always',
    tags: ['city'],
    state: validState('location', { parent_location_id: null }),
    createdAt: BASE,
    updatedAt: BASE,
  },
  {
    id: ID.market,
    branchId: MAIN,
    kind: 'location',
    name: 'The Drowned Market',
    description: 'Stalls under leaking canvas where anything can be bought except silence.',
    status: 'active',
    injectionMode: 'auto',
    tags: ['market'],
    state: validState('location', { parent_location_id: ID.hollow, condition: 'fire-scarred' }),
    createdAt: BASE + MIN,
    updatedAt: BASE + 8 * DAY,
  },
  {
    id: ID.keep,
    branchId: MAIN,
    kind: 'location',
    name: 'The River Keep',
    description: 'A fortress leaning over the water; the Syndicate’s in all but name.',
    status: 'active',
    injectionMode: 'auto',
    tags: ['fortress'],
    state: validState('location', { parent_location_id: null, condition: 'fortified' }),
    createdAt: BASE + 2 * MIN,
    updatedAt: BASE + 2 * MIN,
  },
  {
    id: ID.blade,
    branchId: MAIN,
    kind: 'item',
    name: 'Courier’s Blade',
    description: 'A short, plain knife worn to a whisper of an edge.',
    status: 'active',
    injectionMode: 'auto',
    tags: ['weapon'],
    state: validState('item', { at_location_id: null, condition: 'well-kept' }),
    createdAt: BASE,
    updatedAt: BASE,
  },
  {
    id: ID.amulet,
    branchId: MAIN,
    kind: 'item',
    name: 'The Veilstone Amulet',
    description: 'Warm to the touch, it answers questions you did not ask aloud.',
    status: 'active',
    injectionMode: 'always',
    tags: ['artifact', 'plot'],
    state: validState('item', { at_location_id: null, condition: 'humming faintly' }),
    createdAt: BASE,
    updatedAt: BASE + 12 * DAY,
  },
  {
    id: ID.key,
    branchId: MAIN,
    kind: 'item',
    name: 'The Keep’s Old Key',
    description: 'Rusted iron, far too large for any lock still in use.',
    status: 'active',
    injectionMode: 'disabled',
    tags: ['key'],
    state: validState('item', { at_location_id: ID.keep, condition: 'rusted' }),
    createdAt: BASE + 4 * MIN,
    updatedAt: BASE + 4 * MIN,
  },
  {
    id: ID.watch,
    branchId: MAIN,
    kind: 'faction',
    name: 'The City Watch',
    description: 'Underpaid, over-feared, and quietly at war with the Syndicate.',
    status: 'active',
    injectionMode: 'auto',
    tags: ['faction'],
    state: validState('faction', {
      standing: 'wary allies',
      agenda: ['keep the peace', 'curb the Syndicate'],
    }),
    createdAt: BASE,
    updatedAt: BASE,
  },
  {
    id: ID.syndicate,
    branchId: MAIN,
    kind: 'faction',
    name: 'The Veil Syndicate',
    description: 'Smugglers of secrets who want the amulet more than they want the city.',
    status: 'active',
    injectionMode: 'always',
    tags: ['faction', 'antagonist'],
    state: validState('faction', {
      standing: 'hostile',
      agenda: ['control the Veil', 'seize the amulet'],
    }),
    createdAt: BASE,
    updatedAt: BASE + 12 * DAY,
  },
]

// Canonical order requires aId < bId; the chosen char IDs already sort kael<mira<vorne.
const heroRelationships: NewCharacterRelationship[] = [
  {
    id: 'rel_kael_mira',
    branchId: MAIN,
    aId: ID.kael,
    bId: ID.mira,
    kind: 'ally',
    inverseKind: 'ally',
    createdAt: BASE + MIN,
    updatedAt: BASE + 9 * DAY,
  },
  {
    id: 'rel_kael_vorne',
    branchId: MAIN,
    aId: ID.kael,
    bId: ID.vorne,
    kind: 'rival',
    inverseKind: 'rival',
    createdAt: BASE + 2 * MIN,
    updatedAt: BASE + 11 * DAY,
  },
  {
    id: 'rel_mira_vorne',
    branchId: MAIN,
    aId: ID.mira,
    bId: ID.vorne,
    kind: 'wary of',
    inverseKind: 'distrusts',
    createdAt: BASE + 3 * MIN,
    updatedAt: BASE + 10 * DAY,
  },
]

const heroLore: NewLore[] = [
  {
    id: 'lore_veil',
    branchId: MAIN,
    title: 'The Veil',
    body: 'A membrane between the city and what it was built to contain; it thins where memory is thickest.',
    category: 'cosmology',
    tags: ['veil', 'magic'],
    keywords: ['veil', 'thinning'],
    injectionMode: 'always',
    priority: 10,
    embeddingStale: 0,
    createdAt: BASE,
    updatedAt: BASE,
  },
  {
    id: 'lore_syndicate',
    branchId: MAIN,
    title: 'Origins of the Syndicate',
    body: 'Founded by exiled archivists who learned that secrets, properly kept, are a currency the Veil will honor.',
    category: 'history',
    tags: ['syndicate'],
    keywords: ['syndicate', 'archivists'],
    injectionMode: 'auto',
    priority: 5,
    embeddingStale: 0,
    createdAt: BASE + MIN,
    updatedAt: BASE + MIN,
  },
  {
    id: 'lore_amulet',
    branchId: MAIN,
    title: 'The Veilstone',
    body: 'One of three stones said to anchor the Veil. Two are lost. The third is warm against your chest.',
    category: 'artifact',
    tags: ['amulet', 'plot'],
    keywords: ['veilstone', 'amulet'],
    injectionMode: 'always',
    priority: 9,
    embeddingStale: 1,
    createdAt: BASE + 2 * MIN,
    updatedAt: BASE + 6 * DAY,
  },
  {
    id: 'lore_watch',
    branchId: MAIN,
    title: 'The City Watch',
    body: 'Sworn to the Hollow rather than its rulers, which is why the rulers keep them poor.',
    category: 'faction',
    tags: ['watch'],
    keywords: ['watch'],
    injectionMode: 'disabled',
    priority: 2,
    embeddingStale: 0,
    createdAt: BASE + 3 * MIN,
    updatedAt: BASE + 3 * MIN,
  },
  {
    id: 'lore_prophecy',
    branchId: MAIN,
    title: 'The Drowned Prophecy',
    body: 'When the rain forgets to stop, a courier will carry the city’s second face through the Veil.',
    category: 'prophecy',
    tags: ['prophecy'],
    keywords: ['rain', 'courier'],
    injectionMode: 'auto',
    priority: 7,
    embeddingStale: 0,
    createdAt: BASE + 4 * MIN,
    updatedAt: BASE + 4 * MIN,
  },
]

const heroThreads: NewThread[] = [
  {
    id: 'thread_amulet',
    branchId: MAIN,
    title: 'What the amulet wants',
    description: 'The Veilstone reacts to places, not people. Find out why.',
    category: 'mystery',
    icon: 'sparkles',
    status: 'active',
    injectionMode: 'always',
    triggeredAtEntryId: entryId('hero', 5),
    resolvedAtEntryId: null,
    embeddingStale: 0,
    createdAt: BASE + 5 * MIN,
    updatedAt: BASE + 7 * DAY,
  },
  {
    id: 'thread_syndicate',
    branchId: MAIN,
    title: 'Expose the Syndicate broker',
    description: 'Vorne answers to someone. Names lead to names.',
    category: 'goal',
    icon: 'eye',
    status: 'pending',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 0,
    createdAt: BASE + 6 * MIN,
    updatedAt: BASE + 6 * MIN,
  },
  {
    id: 'thread_trust',
    branchId: MAIN,
    title: 'Earn Mira’s trust',
    description: 'She is testing you. So far you are passing.',
    category: 'relationship',
    icon: 'handshake',
    status: 'resolved',
    injectionMode: 'auto',
    triggeredAtEntryId: entryId('hero', 8),
    resolvedAtEntryId: entryId('hero', 50),
    embeddingStale: 0,
    createdAt: BASE + 7 * MIN,
    updatedAt: BASE + 9 * DAY,
  },
  {
    id: 'thread_keep',
    branchId: MAIN,
    title: 'Escape the River Keep',
    description: 'The first attempt ended badly. The key is still in there.',
    category: 'goal',
    icon: 'door',
    status: 'failed',
    injectionMode: 'always',
    triggeredAtEntryId: entryId('hero', 44),
    resolvedAtEntryId: entryId('hero', 47),
    embeddingStale: 0,
    createdAt: BASE + 8 * MIN,
    updatedAt: BASE + 11 * DAY,
  },
]

const heroHappenings: NewHappening[] = [
  {
    id: 'hap_ambush',
    branchId: MAIN,
    title: 'The alley ambush',
    description: 'Vorne’s people corner Kael; Mira pulls him clear.',
    category: 'conflict',
    icon: 'swords',
    temporal: null,
    occurredAtEntryId: entryId('hero', 10),
    commonKnowledge: 0,
    embeddingStale: 0,
    createdAt: BASE + 10 * MIN,
    updatedAt: BASE + 10 * MIN,
  },
  {
    id: 'hap_fire',
    branchId: MAIN,
    title: 'The market fire',
    description: 'A stall burns in the Drowned Market, drawing the Watch into the open.',
    category: 'disaster',
    icon: 'flame',
    temporal: null,
    occurredAtEntryId: entryId('hero', 22),
    commonKnowledge: 1,
    embeddingStale: 0,
    createdAt: BASE + 22 * MIN,
    updatedAt: BASE + 22 * MIN,
  },
  {
    id: 'hap_betrayal',
    branchId: MAIN,
    title: 'The old betrayal',
    description: 'Years ago the Ashen Sage handed a Watch captain to the Syndicate.',
    category: 'history',
    icon: 'mask',
    temporal: 'years past',
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 0,
    createdAt: BASE + 11 * MIN,
    updatedAt: BASE + 11 * MIN,
  },
  {
    id: 'hap_pact',
    branchId: MAIN,
    title: 'Vorne’s pact',
    description: 'Vorne offers Kael safe passage for the amulet; nothing about it is safe.',
    category: 'conflict',
    icon: 'scroll',
    temporal: null,
    occurredAtEntryId: entryId('hero', 48),
    commonKnowledge: 0,
    embeddingStale: 0,
    createdAt: BASE + 48 * MIN,
    updatedAt: BASE + 48 * MIN,
  },
]

const heroInvolvements: NewHappeningInvolvement[] = [
  {
    id: 'inv_ambush_kael',
    branchId: MAIN,
    happeningId: 'hap_ambush',
    entityId: ID.kael,
    role: 'target',
  },
  {
    id: 'inv_ambush_vorne',
    branchId: MAIN,
    happeningId: 'hap_ambush',
    entityId: ID.vorne,
    role: 'aggressor',
  },
  {
    id: 'inv_fire_mira',
    branchId: MAIN,
    happeningId: 'hap_fire',
    entityId: ID.mira,
    role: 'witness',
  },
  {
    id: 'inv_fire_watch',
    branchId: MAIN,
    happeningId: 'hap_fire',
    entityId: ID.watch,
    role: 'responder',
  },
  {
    id: 'inv_betrayal_sage',
    branchId: MAIN,
    happeningId: 'hap_betrayal',
    entityId: ID.sage,
    role: 'betrayer',
  },
  {
    id: 'inv_pact_kael',
    branchId: MAIN,
    happeningId: 'hap_pact',
    entityId: ID.kael,
    role: 'party',
  },
  {
    id: 'inv_pact_vorne',
    branchId: MAIN,
    happeningId: 'hap_pact',
    entityId: ID.vorne,
    role: 'party',
  },
]

// characterId must be a character entity; the natural key is (branch, character, happening).
const heroAwareness: NewHappeningAwareness[] = [
  {
    id: 'aw_ambush_kael',
    branchId: MAIN,
    happeningId: 'hap_ambush',
    characterId: ID.kael,
    learnedAtEntryId: entryId('hero', 10),
    decayResistance: 0.9,
    retrievalCount: 3,
    source: 'witnessed',
  },
  {
    id: 'aw_ambush_mira',
    branchId: MAIN,
    happeningId: 'hap_ambush',
    characterId: ID.mira,
    learnedAtEntryId: entryId('hero', 12),
    decayResistance: 0.6,
    retrievalCount: 1,
    source: 'told',
  },
  {
    id: 'aw_fire_mira',
    branchId: MAIN,
    happeningId: 'hap_fire',
    characterId: ID.mira,
    learnedAtEntryId: entryId('hero', 22),
    decayResistance: 0.8,
    retrievalCount: 2,
    source: 'witnessed',
  },
  {
    id: 'aw_fire_kael',
    branchId: MAIN,
    happeningId: 'hap_fire',
    characterId: ID.kael,
    learnedAtEntryId: entryId('hero', 24),
    decayResistance: 0.5,
    retrievalCount: 1,
    source: 'told',
  },
  {
    id: 'aw_betrayal_kael',
    branchId: MAIN,
    happeningId: 'hap_betrayal',
    characterId: ID.kael,
    learnedAtEntryId: entryId('hero', 36),
    decayResistance: 0.4,
    retrievalCount: 0,
    source: 'discovered',
  },
  {
    id: 'aw_pact_kael',
    branchId: MAIN,
    happeningId: 'hap_pact',
    characterId: ID.kael,
    learnedAtEntryId: entryId('hero', 48),
    decayResistance: 1,
    retrievalCount: 2,
    source: 'witnessed',
  },
  {
    id: 'aw_pact_vorne',
    branchId: MAIN,
    happeningId: 'hap_pact',
    characterId: ID.vorne,
    learnedAtEntryId: entryId('hero', 48),
    decayResistance: 1,
    retrievalCount: 2,
    source: 'witnessed',
  },
]

const heroEraFlips: NewBranchEraFlip[] = [
  { id: 'era_hero_1', branchId: MAIN, atWorldtime: 0, eraName: 'The Age of Ash', createdAt: BASE },
  {
    id: 'era_hero_2',
    branchId: MAIN,
    atWorldtime: 120,
    eraName: 'The Reckoning',
    createdAt: BASE + 8 * DAY,
  },
]

const heroTranslations: NewTranslation[] = [
  {
    id: 'tr_kael_name',
    branchId: MAIN,
    targetKind: 'entity',
    targetId: ID.kael,
    field: 'name',
    language: 'es',
    translatedText: 'Kael',
    createdAt: BASE,
    updatedAt: BASE,
  },
  {
    id: 'tr_kael_desc',
    branchId: MAIN,
    targetKind: 'entity',
    targetId: ID.kael,
    field: 'description',
    language: 'es',
    translatedText:
      'Un mensajero convertido en fugitivo, portando un amuleto que no debería existir.',
    createdAt: BASE,
    updatedAt: BASE,
  },
  {
    id: 'tr_lore_veil',
    branchId: MAIN,
    targetKind: 'lore',
    targetId: 'lore_veil',
    field: 'body',
    language: 'es',
    translatedText:
      'Una membrana entre la ciudad y aquello para lo que fue construida para contener.',
    createdAt: BASE,
    updatedAt: BASE,
  },
  {
    id: 'tr_entry_open',
    branchId: MAIN,
    targetKind: 'story_entry',
    targetId: entryId('hero', 1),
    field: 'content',
    language: 'es',
    translatedText: 'Llegas a Hondonada del Velo con un amuleto que no puedes explicar.',
    createdAt: BASE,
    updatedAt: BASE,
  },
]

const heroEntryAssets: NewEntryAsset[] = [
  {
    id: 'ea_hero_1',
    branchId: MAIN,
    entryId: entryId('hero', 6),
    assetId: 'asset_inline_1',
    role: 'inline',
    position: 0,
  },
]

const heroDeltas: NewDelta[] = [
  {
    id: 'delta_hero_1',
    branchId: MAIN,
    entryId: entryId('hero', 14),
    actionId: 'seed_act_edit_1',
    logPosition: 1,
    source: 'user_edit',
    targetTable: 'story_entries',
    targetId: entryId('hero', 14),
    op: 'update',
    undoPayload: { content: 'I draw the blade and wait.' },
    encodingVersion: 1,
    createdAt: BASE + 14 * MIN,
  },
  {
    id: 'delta_hero_2',
    branchId: MAIN,
    entryId: entryId('hero', 22),
    actionId: 'seed_act_class_1',
    logPosition: 2,
    source: 'ai_classifier',
    targetTable: 'happenings',
    targetId: 'hap_fire',
    op: 'create',
    undoPayload: null,
    encodingVersion: 1,
    createdAt: BASE + 22 * MIN,
  },
  {
    id: 'delta_hero_3',
    branchId: MAIN,
    entryId: null,
    actionId: 'seed_act_chapter_1',
    logPosition: 3,
    source: 'chapter_close',
    targetTable: 'chapters',
    targetId: 'chap_hero_1',
    op: 'create',
    undoPayload: null,
    encodingVersion: 1,
    createdAt: BASE + 6 * DAY,
  },
]

// Every persisted entry carries a create delta (the rollback window resolves
// from it — operational.ts rejects without one); seeding rows bare makes
// delete/rollback silently dead on every seeded story. Sources mirror the
// real writers: user_edit for user turns, ai_classifier for model output.
function entryCreateDeltas(allEntries: NewStoryEntry[]): NewDelta[] {
  const nextLogPosition = new Map<string, number>()
  return allEntries.map((e) => {
    const lp = nextLogPosition.get(e.branchId) ?? 1
    nextLogPosition.set(e.branchId, lp + 1)
    return {
      id: `delta_create_${e.branchId}_${e.id}`,
      branchId: e.branchId,
      entryId: null,
      actionId: `seed_act_create_${e.branchId}_${e.id}`,
      logPosition: lp,
      source: e.kind === 'user_action' ? ('user_edit' as const) : ('ai_classifier' as const),
      targetTable: 'story_entries',
      targetId: e.id,
      op: 'create' as const,
      undoPayload: null,
      encodingVersion: 1,
      createdAt: e.createdAt,
    }
  })
}

// ---------------------------------------------------------------------------
// Filler stories — breadth for the story-list screen + light open coverage.
// Creative/third-person needs no lead entity; one adventure filler carries a lead.
// ---------------------------------------------------------------------------

type Filler = {
  key: string
  title: string
  description: string | null
  status: NewStory['status']
  favorite: number
  tags: string[]
  accentColor: string | null
  def: StoryDefinition
  entries: number
  lead?: NewEntity
}

const fillerLead: NewEntity = {
  id: 'char_sable',
  branchId: 'branch_active2_main',
  kind: 'character',
  name: 'Sable',
  description: 'A cartographer mapping a coast that keeps redrawing itself.',
  status: 'active',
  injectionMode: 'always',
  tags: ['protagonist'],
  state: validState('character', {
    visual: {},
    traits: ['curious'],
    drives: ['finish the map'],
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    faction_id: null,
    lastSeenAt: null,
  }),
  createdAt: BASE + 2 * DAY,
  updatedAt: BASE + 2 * DAY,
}

const fillers: Filler[] = [
  {
    key: 'draft',
    title: 'A Lantern for the Tide',
    description: 'An unfinished draft about a lighthouse keeper who answers the wrong signal.',
    status: 'draft',
    favorite: 0,
    tags: ['draft', 'horror'],
    accentColor: '#3b82f6',
    def: definition({
      mode: 'creative',
      narration: 'third',
      leadEntityId: null,
      genre: 'gothic horror',
      tone: 'foreboding',
      setting: 'a storm-lashed coast',
    }),
    entries: 2,
  },
  {
    key: 'archived',
    title: 'The Cartographer’s Apology',
    description: 'Archived after three chapters; the map outgrew the mapmaker.',
    status: 'archived',
    favorite: 0,
    tags: ['archived', 'adventure'],
    accentColor: null,
    def: definition({
      mode: 'creative',
      narration: 'third',
      leadEntityId: null,
      genre: 'travelogue',
      tone: 'wistful',
      setting: 'a shifting archipelago',
    }),
    entries: 3,
  },
  {
    key: 'active2',
    title: 'Sable and the Redrawn Coast',
    description: 'An active adventure following Sable along an impossible shoreline.',
    status: 'active',
    favorite: 1,
    tags: ['adventure', 'mystery'],
    accentColor: '#f59e0b',
    def: definition({
      mode: 'adventure',
      narration: 'second',
      leadEntityId: 'char_sable',
      genre: 'adventure',
      tone: 'curious',
      setting: 'a coast that will not hold still',
    }),
    entries: 4,
    lead: fillerLead,
  },
  {
    key: 'creative',
    title: 'Letters to the Drowned',
    description: 'A creative-mode piece composed entirely of undelivered letters.',
    status: 'active',
    favorite: 0,
    tags: ['epistolary', 'literary'],
    accentColor: '#a855f7',
    def: definition({
      mode: 'creative',
      narration: 'third',
      leadEntityId: null,
      genre: 'literary',
      tone: 'melancholic',
      setting: 'a sunken parish',
    }),
    entries: 3,
  },
  {
    key: 'tags',
    title:
      'The Very Long and Deliberately Overwrought Title That Tests How Story Cards Wrap Their Headings',
    description:
      'A list-screen layout stressor: a long title, a long description, and a heavy tag set so the card, its truncation, and its tag overflow can all be exercised at once without opening the story.',
    status: 'active',
    favorite: 1,
    tags: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'],
    accentColor: '#10b981',
    def: definition({
      mode: 'creative',
      narration: 'third',
      leadEntityId: null,
      genre: 'experimental',
      tone: 'playful',
      setting: 'a city of indices',
    }),
    entries: 2,
  },
]

function fillerStoryRows(): {
  stories: NewStory[]
  branches: NewBranch[]
  entries: NewStoryEntry[]
  entities: NewEntity[]
} {
  const storyRows: NewStory[] = []
  const branchRows: NewBranch[] = []
  const entryRows: NewStoryEntry[] = []
  const entityRows: NewEntity[] = []

  fillers.forEach((f, fi) => {
    const storyId = `story_${f.key}`
    const branchId = `branch_${f.key}_main`
    const t0 = BASE + (fi + 2) * DAY
    storyRows.push({
      id: storyId,
      title: f.title,
      description: f.description,
      tags: f.tags,
      accentColor: f.accentColor,
      status: f.status,
      favorite: f.favorite,
      lastOpenedAt: f.status === 'active' ? t0 + 3 * MIN : null,
      definition: f.def,
      settings: settings({
        translation: {
          enabled: false,
          targetLanguage: null,
          granularToggles: {
            narrative: false,
            entityNames: false,
            entityDescriptions: false,
            lore: false,
            threads: false,
            happenings: false,
            chapterMeta: false,
          },
        },
      }),
      createdAt: t0,
      updatedAt: t0 + 3 * MIN,
      currentBranchId: branchId,
    })
    branchRows.push({
      id: branchId,
      storyId,
      parentBranchId: null,
      forkEntryId: null,
      name: 'Main',
      createdAt: t0,
      classifierStatus: null,
    })
    if (f.lead) entityRows.push(f.lead)
    for (let i = 1; i <= f.entries; i++) {
      const kind: NewStoryEntry['kind'] =
        i === 1 ? 'opening' : i % 2 === 0 ? 'user_action' : 'ai_reply'
      entryRows.push({
        id: entryId(f.key, i),
        branchId,
        position: i,
        kind,
        content:
          i === 1
            ? `[${f.title}] ${f.description ?? 'An opening scene.'}`
            : kind === 'user_action'
              ? ACTION_LINES[(fi + i) % ACTION_LINES.length]
              : `${REPLY_LINES[(fi + i) % REPLY_LINES.length]} ${REPLY_BEATS[(fi + i) % REPLY_BEATS.length]}`,
        chapterId: null,
        metadata: entryMetadataSchema.parse({
          sceneEntities: f.lead ? [f.lead.id] : [],
          currentLocationId: null,
          worldTime: (i - 1) * 2,
        }),
        createdAt: t0 + i * MIN,
      })
    }
  })

  return { stories: storyRows, branches: branchRows, entries: entryRows, entities: entityRows }
}

// ---------------------------------------------------------------------------
// Rich-rendering story — provider-authored visual HTML that exceeds the RNRH
// subset, driving the rich-entry path (ui/patterns/rich-entry-rendering.md).
// Feeds the on-device validation checklist: boot latency, WebView count,
// scroll fps, and the item-7 security probes (which must render inert).
// ---------------------------------------------------------------------------

const RICH = 'story_rich'
const RMAIN = 'branch_rich_main'

const RICH_OPENING =
  'A plain opening: the gallery of impossible rooms admits one visitor at a time. Every door beyond this one is painted in styles no honest wall should hold.'

const RICH_ACTIONS = [
  'I step into the next room and study the wall.',
  'I run a hand along the frame, checking for seams.',
  'I note what the plaque claims and move on.',
  'I compare this room with the one before it.',
]

// Each payload is one provider-authored rich rendering the plain RNRH tail
// cannot express. Labels keep on-device triage readable.
const RICH_PAYLOADS: readonly { label: string; md: string }[] = [
  {
    label: 'gradient panel',
    md: 'The first room breathes color.\n\n<div style="background: linear-gradient(135deg, #0f172a, #6d28d9); color: #f8fafc; padding: 14px; border-radius: 10px">A wall of dusk-to-violet light, edge to edge.</div>',
  },
  {
    label: 'keyframes glow',
    md: 'Something in here pulses.\n\n<style>@keyframes seed-pulse { 50% { opacity: 0.35 } } .seed-glow { animation: seed-pulse 1.6s infinite }</style><p class="seed-glow">The lantern dims and returns, dims and returns.</p>',
  },
  {
    label: 'pipe table',
    md: 'The plaque lists the exhibits:\n\n| Room | Style | Verdict |\n| ---- | ----- | ------- |\n| I | Gradient | unsettling |\n| II | Animated | worse |\n| III | Tabular | honest |',
  },
  {
    label: 'grid layout',
    md: 'Two alcoves face each other.\n\n<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px"><div style="background: #1e293b; color: #e2e8f0; padding: 10px; border-radius: 6px">Left: a chair, facing away.</div><div style="background: #334155; color: #e2e8f0; padding: 10px; border-radius: 6px">Right: a chair, facing you.</div></div>',
  },
  {
    label: 'positioned badge',
    md: 'A catalogue card hangs crooked.\n\n<div style="position: relative; border: 1px solid #64748b; border-radius: 8px; padding: 12px">Exhibit IV — the frame is empty.<span style="position: absolute; top: -8px; right: 10px; background: #dc2626; color: #fff; padding: 2px 8px; border-radius: 999px; font-size: 12px">ON LOAN</span></div>',
  },
  {
    label: 'media query',
    md: 'The room resizes to fit its visitor.\n\n<style>.seed-resp { padding: 10px; border-radius: 6px; background: #14532d; color: #dcfce7 } @media (max-width: 480px) { .seed-resp { background: #7c2d12; color: #ffedd5 } }</style><div class="seed-resp">Wide walls are green; narrow walls burn orange.</div>',
  },
  {
    label: 'shadow card',
    md: 'One plinth floats a finger above its shadow.\n\n<div style="box-shadow: 0 8px 24px rgba(0,0,0,0.45); border-radius: 12px; padding: 14px; border: 1px solid #475569">The stone does not touch the floor. The shadow disagrees.</div>',
  },
  {
    label: 'pseudo-element',
    md: 'The corridor numbers itself.\n\n<style>.seed-orn::before { content: "❖ "; color: #a855f7 }</style><p class="seed-orn">Every doorway wears the same violet mark.</p>',
  },
  {
    label: 'long mixed rich',
    md: [
      '## The Long Gallery\n',
      'It keeps going past where the building should end.\n',
      '<div style="background: linear-gradient(90deg, #164e63, #0f172a); color: #e0f2fe; padding: 12px; border-radius: 8px">Case after case, the glass sweating cold.</div>\n',
      '<style>@keyframes seed-drift { from { transform: translateX(0) } to { transform: translateX(6px) } } .seed-drift { animation: seed-drift 2.2s infinite alternate }</style><p class="seed-drift">The dust motes drift the wrong way.</p>\n',
      '| Case | Contents |\n| ---- | -------- |\n| 12 | a key, label missing |\n| 13 | a label, key missing |\n| 14 | neither |\n',
      'At the far end, a door you are certain was not there when you entered.',
    ].join('\n'),
  },
  // Security probes — checklist item 7. Each must render as inert text /
  // styling: scrub strips the fetch vectors, CSP backstops, the navigation
  // lock catches the links. A network request or navigation here is a FAIL.
  {
    label: 'probe: url exfil',
    md: 'PROBE url(): nothing in this room may phone home.\n\n<div style="background: url(https://probe.invalid/exfil.png); border: 1px solid #ef4444; padding: 10px">If this box fetched an image, the scrub failed.</div><style>.seed-exfil { background: url(/**/https://probe.invalid/comment.png) } @media screen { .seed-exfil2 { background: url(https://probe.invalid/media.png) } }</style>',
  },
  {
    label: 'probe: import/font-face',
    md: 'PROBE @import: external stylesheets must not load.\n\n<style>@import url("https://probe.invalid/x.css"); @font-face { font-family: Exfil; src: url(https://probe.invalid/f.woff2) } .seed-imp { border: 1px dashed #f59e0b; padding: 8px }</style><div class="seed-imp">A dashed amber border is the only styling this entry may keep.</div>',
  },
  {
    label: 'probe: style breakout',
    md: 'PROBE breakout: the stylesheet tries to close itself.\n\n<style>.seed-brk::after { content: "</style><img src=x onerror=console.error(\'breakout\')>" }</style><p class="seed-brk">If an image error fired, the escape hatch worked for the attacker.</p>',
  },
  {
    label: 'probe: navigation lock',
    // The gradient wrapper is load-bearing: bare anchors are RNRH-modeled and
    // would stay on the plain path, never reaching the WebView this probes.
    md: 'PROBE links: hrefs are stripped at sanitize — these must render as plain text and tapping them must do nothing.\n\n<div style="background: linear-gradient(90deg, #312e81, #111827); color: #e0e7ff; padding: 10px; border-radius: 8px"><p><a href="https://example.com" target="_blank">http link — plain text, no navigation</a></p><p><a href="javascript:console.error(\'js-href\')">javascript: link — plain text, no navigation</a></p></div>',
  },
  {
    label: 'probe: script',
    md: 'PROBE script: no code runs in this room.\n\n<script>console.error("seed script executed")</script><img src="x" onerror="console.error(\'seed onerror executed\')"><p>Both payloads above must be stripped before this renders.</p>',
  },
]

const N_RICH = 60

function richEntries(): NewStoryEntry[] {
  const rows: NewStoryEntry[] = []
  let payloadIndex = 0
  for (let i = 1; i <= N_RICH; i++) {
    const kind: NewStoryEntry['kind'] =
      i === 1 ? 'opening' : i % 2 === 0 ? 'user_action' : 'ai_reply'
    let content: string
    if (kind === 'opening') {
      content = RICH_OPENING
    } else if (kind === 'user_action') {
      content = RICH_ACTIONS[(i / 2) % RICH_ACTIONS.length]!
    } else {
      // Every third reply stays plain so scroll runs cross mixed rows; the
      // rest cycle the payload deck (probes included) and the deck restarts
      // near the tail so a bottom-open lands on a dense rich stretch.
      if (i % 3 === 0) {
        content = `Room ${i}: an ordinary wall, restfully beige. ${REPLY_BEATS[i % REPLY_BEATS.length]}`
      } else {
        const payload = RICH_PAYLOADS[payloadIndex % RICH_PAYLOADS.length]!
        payloadIndex += 1
        content = payload.md
      }
    }
    rows.push({
      id: entryId('rich', i),
      branchId: RMAIN,
      position: i,
      kind,
      content,
      chapterId: null,
      metadata: entryMetadataSchema.parse({
        sceneEntities: [],
        currentLocationId: null,
        worldTime: i,
        ...(kind === 'ai_reply'
          ? { model: 'seed/rich', tokens: { prompt: 600 + i, completion: 180 + i } }
          : {}),
      }),
      createdAt: BASE + 2 * DAY + i * MIN,
    })
  }
  return rows
}

function richStoryRows(): { story: NewStory; branch: NewBranch; entries: NewStoryEntry[] } {
  const t0 = BASE + 2 * DAY
  return {
    story: {
      id: RICH,
      title: 'The Gallery of Impossible Rooms',
      description:
        'Rich-rendering validation set: gradients, animations, tables, layout, and the item-7 security probes.',
      tags: ['dev', 'rich-rendering'],
      accentColor: '#0ea5e9',
      status: 'active',
      favorite: 0,
      lastOpenedAt: t0 + N_RICH * MIN,
      // creative + third person: the only lead-entity-free combination, and
      // this story needs no entity graph — it exists to render, not to play.
      definition: definition({
        mode: 'creative',
        narration: 'third',
        leadEntityId: null,
        genre: 'surreal museum',
        tone: 'deadpan curatorial',
        setting: 'a gallery whose rooms are rendering testcases',
      }),
      settings: settings(),
      createdAt: t0,
      updatedAt: t0 + N_RICH * MIN,
      currentBranchId: RMAIN,
    },
    branch: {
      id: RMAIN,
      storyId: RICH,
      parentBranchId: null,
      forkEntryId: null,
      name: 'Main',
      createdAt: t0,
      classifierStatus: null,
    },
    entries: richEntries(),
  }
}

// ---------------------------------------------------------------------------
// Cross-story singletons.
// ---------------------------------------------------------------------------

const vaultCalendarRows: NewVaultCalendar[] = [
  {
    id: CAL,
    name: 'Standard Reckoning',
    definition: { tiers: ['year', 'season', 'day'], daysPerYear: 360, seasonsPerYear: 4 },
    favorite: 1,
    createdAt: BASE,
    updatedAt: BASE,
  },
]

const assetRows: NewAsset[] = [
  {
    id: 'asset_cover_hero',
    kind: 'image',
    mimeType: 'image/png',
    filePath: 'assets/seed/hero-cover.png',
    sizeBytes: 184_320,
    contentHash: 'seedhash_cover',
    createdAt: BASE,
    pendingDeleteAt: null,
  },
  {
    id: 'asset_inline_1',
    kind: 'image',
    mimeType: 'image/png',
    filePath: 'assets/seed/market.png',
    sizeBytes: 96_240,
    contentHash: 'seedhash_inline',
    createdAt: BASE + MIN,
    pendingDeleteAt: null,
  },
]

const pipelineRunRows: NewPipelineRun[] = [
  {
    runId: 'run_hero_1',
    kind: 'narrative',
    actionId: 'seed_act_run_1',
    storyId: HERO,
    startedAt: BASE + 70 * MIN,
    finishedAt: BASE + 70 * MIN + 4_200,
    outcome: 'completed',
  },
]

const appSettingsRow: NewAppSettings = {
  id: 'singleton',
  providers: [
    providerInstanceSchema.parse({
      id: 'prov_local',
      type: 'openai-compatible',
      displayName: 'Local (seed)',
      apiKey: '',
      endpoint: 'http://localhost:1234/v1',
      favoriteModelIds: ['seed/narrative'],
      cachedModels: [{ id: 'seed/narrative' }],
    }),
  ],
  profiles: [
    modelProfileSchema.parse({
      id: 'prof_narrative',
      kind: 'narrative',
      name: 'Seed Narrative',
      modelRef: { providerId: 'prov_local', modelId: 'seed/narrative' },
      temperature: 0.8,
    }),
  ],
  assignments: { narrative: 'prof_narrative' },
  defaultProviderId: 'prov_local',
  embeddingModelId: 'bge-small-en',
  embeddingProviderId: 'prov_local',
  defaultStorySettings: { activePackId: BUNDLED_PACK_ID },
  defaultCalendarId: CAL,
  defaultSuggestionCategories: { adventure: [], creative: [] },
  appearance: appearanceSchema.parse({ themeId: 'system', readerFontScale: 1, density: 'default' }),
  uiLanguage: 'en',
  onboardingCompletedAt: BASE,
  diagnostics: { enabled: false, debug_level_enabled: false },
  createdAt: BASE,
  updatedAt: BASE,
}

// ---------------------------------------------------------------------------

export function buildSeedSteps(): SeedStep[] {
  const filler = fillerStoryRows()
  const rich = richStoryRows()
  const allEntries = [...heroEntries(), ...forkEntries(), ...rich.entries, ...filler.entries]
  const createDeltaRows = entryCreateDeltas(allEntries)
  // The hand-authored hero deltas keep their order but slot after MAIN's
  // create block — log_position is unique per branch.
  const mainCreateCount = createDeltaRows.filter((d) => d.branchId === MAIN).length
  const shiftedHeroDeltas = heroDeltas.map((d, i) => ({
    ...d,
    logPosition: mainCreateCount + i + 1,
  }))

  const heroStory: NewStory = {
    id: HERO,
    title: 'The Veilstone Courier',
    description:
      'A fugitive courier, an amulet that should not exist, and a city that keeps a second face behind the rain.',
    tags: ['fantasy', 'mystery', 'intrigue'],
    coverAssetId: 'asset_cover_hero',
    accentColor: '#7c3aed',
    status: 'active',
    favorite: 1,
    lastOpenedAt: BASE + 12 * DAY,
    definition: definition({
      mode: 'adventure',
      narration: 'second',
      leadEntityId: ID.kael,
      genre: 'low fantasy',
      tone: 'rain-soaked noir',
      setting: 'the drowned city of Veil’s Hollow',
    }),
    settings: settings(),
    createdAt: BASE,
    updatedAt: BASE + 12 * DAY,
    currentBranchId: MAIN,
  }

  const branchRows: NewBranch[] = [
    {
      id: MAIN,
      storyId: HERO,
      parentBranchId: null,
      forkEntryId: null,
      name: 'Main',
      createdAt: BASE,
      classifierStatus: null,
    },
    {
      id: FORK,
      storyId: HERO,
      parentBranchId: MAIN,
      forkEntryId: entryId('hero', 40),
      name: 'The road not taken',
      createdAt: BASE + DAY,
      classifierStatus: null,
    },
    ...filler.branches,
  ]

  // Order encodes FK dependencies: parents before children, assets before
  // entry_assets. The runner inserts in this order with foreign_keys ON, so a
  // broken reference fails the seed loudly instead of landing silently.
  return [
    step('vault_calendars', vaultCalendars, vaultCalendarRows),
    step('assets', assets, assetRows),
    step('stories', stories, [heroStory, rich.story, ...filler.stories]),
    step('branches', branches, [...branchRows, rich.branch]),
    step('story_entries', storyEntries, allEntries),
    step('chapters', chapters, heroChapters),
    step('entities', entities, [...heroEntities, ...filler.entities]),
    step('character_relationships', characterRelationships, heroRelationships),
    step('lore', lore, heroLore),
    step('threads', threads, heroThreads),
    step('happenings', happenings, heroHappenings),
    step('happening_involvements', happeningInvolvements, heroInvolvements),
    step('happening_awareness', happeningAwareness, heroAwareness),
    step('branch_era_flips', branchEraFlips, heroEraFlips),
    step('translations', translations, heroTranslations),
    step('entry_assets', entryAssets, heroEntryAssets),
    step('deltas', deltas, [...createDeltaRows, ...shiftedHeroDeltas]),
    step('pipeline_runs', pipelineRuns, pipelineRunRows),
    step('app_settings', appSettings, [appSettingsRow]),
  ]
}
