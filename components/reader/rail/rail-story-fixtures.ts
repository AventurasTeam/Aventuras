import type { RowSignals } from '@/components/list/list-module'
import type { EntryIndexRead } from '@/hooks/use-entry-index'
import type { Entity, Happening, Lore, StoryEntry, Thread } from '@/lib/db'
import type { EntryRef } from '@/lib/entry-refs'
import type { EntityListSignals } from '@/lib/list-modules'
import type { RecentlyClassified, RowCategory } from '@/lib/row-signals'

import type { RailData } from './use-rail-data'

const BRANCH = 'br_1'

function entity(
  id: string,
  kind: Entity['kind'],
  name: string,
  extra: Partial<Entity> = {},
): Entity {
  return {
    id,
    branchId: BRANCH,
    kind,
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

const ENTITIES: Entity[] = [
  entity('char_kael', 'character', 'Kael'),
  entity('char_mira', 'character', 'Mira'),
  entity('char_vorne', 'character', 'Vorne', { status: 'staged' }),
  entity('loc_hollow', 'location', "Veil's Hollow"),
  entity('item_blade', 'item', 'Courier blade'),
  entity('fac_watch', 'faction', 'The Watch'),
]

const LORE: Lore[] = [
  {
    id: 'lore_veil',
    branchId: BRANCH,
    title: 'The Veil',
    body: 'A membrane between the city and what it was built to contain.',
    category: 'cosmology',
    tags: [],
    keywords: [],
    injectionMode: 'always',
    priority: 10,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

function thread(id: string, title: string, status: Thread['status'], category: string): Thread {
  return {
    id,
    branchId: BRANCH,
    title,
    description: null,
    category,
    icon: null,
    status,
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

const THREADS: Thread[] = [
  thread('t_amulet', 'What the amulet wants', 'active', 'mystery'),
  thread('t_syndicate', 'Expose the Syndicate broker', 'pending', 'goal'),
]

function happening(id: string, title: string, occurredAtEntryId: string): Happening {
  return {
    id,
    branchId: BRANCH,
    title,
    description: null,
    category: 'conflict',
    icon: null,
    temporal: null,
    occurredAtEntryId,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

const HAPPENINGS: Happening[] = [
  happening('h_ambush', 'The alley ambush', 'e_10'),
  happening('h_pact', "Vorne's pact", 'e_48'),
]

// Sixty replies, newest first, the first thirty in a closed chapter: e_48 lands in Current, e_10
// in Earlier.
const ENTRIES: readonly EntryRef[] = Array.from({ length: 60 }, (_, i): EntryRef => {
  const position = 60 - i
  return {
    id: `e_${position}`,
    position,
    kind: 'ai_reply',
    chapterId: position <= 30 ? 'chap_1' : null,
    excerpt: `Entry ${position}`,
  }
})

/** A new tail entry on the fixture branch: hydrating it keys a fresh entry-index read. */
export function railFixtureTurn(position: number): StoryEntry {
  return {
    id: `e_${position}`,
    branchId: BRANCH,
    position,
    kind: 'ai_reply',
    content: '',
    chapterId: null,
    metadata: null,
    createdAt: position,
  }
}

/** The fixture branch's entry read, for `EntryIndexReadProvider`. */
export const readRailFixtureEntries: EntryIndexRead = async () => ENTRIES

const ENTITY_LIST_SIGNALS: EntityListSignals = {
  leadId: 'char_kael',
  inScene: new Set(['char_kael', 'char_mira', 'item_blade', 'loc_hollow']),
}

const ROW_TINTS: ReadonlyMap<string, RecentlyClassified> = new Map([
  ['char_mira', 'fresh'],
  ['item_blade', 'fading'],
  ['t_amulet', 'fading'],
])

const CATEGORY_TINT: ReadonlyMap<RowCategory, RecentlyClassified> = new Map([
  ['character', 'fresh'],
  ['item', 'fading'],
  ['thread', 'fading'],
])

export function railDataFixture(overrides: Partial<RailData> = {}): RailData {
  const entityListSignals = overrides.entityListSignals ?? ENTITY_LIST_SIGNALS
  const { leadId, inScene } = entityListSignals
  const rowSignals = (id: string): Omit<RowSignals, 'collision'> => ({
    lead: id === leadId ? 'you' : null,
    inScene: inScene.has(id),
    recentlyClassified: ROW_TINTS.get(id),
  })
  return {
    branchId: BRANCH,
    entities: ENTITIES,
    lore: LORE,
    threads: THREADS,
    happenings: HAPPENINGS,
    entityListSignals,
    hasClosedChapters: true,
    rowSignals,
    categoryTint: CATEGORY_TINT,
    ...overrides,
  }
}
