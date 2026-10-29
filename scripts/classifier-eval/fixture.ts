import type { ClassifierExtraction } from '@/lib/classifier'
import type {
  CharacterRelationship,
  Entity,
  EntityState,
  Happening,
  StoryEntry,
  Thread,
} from '@/lib/db'
import { entryMetadataSchema } from '@/lib/db'

// Rows carry readable ids (char_tobin, fact_wardens); render.ts maps them to real ids as the seed
// does, and the reply's real ids back, so a check and an ideal reply read in these.
const BRANCH = 'br_eval'
const AT = 1_700_000_000_000

/** Holds on a reply: true when the reply does what the check asks, for an avoid as for an expect. */
export type Check = {
  name: string
  /** expect: an empty reply fails it. avoid: a reply that does nothing passes it. */
  kind: 'expect' | 'avoid'
  /** rule: a rule in the prompt asks for it. judgment: no rule does, so a miss points at a gap. */
  basis: 'rule' | 'judgment'
  holds: (reply: ClassifierExtraction) => boolean
}

export type EvalWindow = {
  name: string
  about: string
  /** The story's lead, for a window narrated in the first or second person. */
  lead?: string
  entities: Entity[]
  happenings: Happening[]
  relationships: CharacterRelationship[]
  threads: Thread[]
  entries: StoryEntry[]
  checks: Check[]
  /** Passes every check: proof that each one can hold. */
  ideal: ClassifierExtraction
  /** Fails every avoid check: proof that each one can fail. */
  bad: ClassifierExtraction
}

export function reply(lists: Partial<ClassifierExtraction>): ClassifierExtraction {
  return {
    happenings: [],
    relationships: [],
    statusFlips: [],
    newCharacters: [],
    newFactions: [],
    memberships: [],
    aliases: [],
    renames: [],
    placements: [],
    standings: [],
    newThreads: [],
    threadStatuses: [],
    knownAwareness: [],
    ...lists,
  }
}

const entityRow = (
  id: string,
  kind: Entity['kind'],
  name: string,
  opts: { description?: string; status?: Entity['status']; keywords?: string[] },
  state: EntityState,
): Entity => ({
  id,
  branchId: BRANCH,
  kind,
  name,
  description: opts.description ?? null,
  status: opts.status ?? 'active',
  retiredReason: null,
  injectionMode: 'auto',
  nameCollisionFlag: 0,
  nameCollisionPartnerId: null,
  nameCollisionReason: null,
  state,
  tags: [],
  keywords: opts.keywords ?? [],
  priority: 0,
  embeddingStale: 0,
  createdAt: AT,
  updatedAt: AT,
})

export const character = (
  id: string,
  name: string,
  opts: {
    description?: string
    status?: Entity['status']
    keywords?: string[]
    faction?: string
  } = {},
): Entity =>
  entityRow(id, 'character', name, opts, {
    visual: {},
    traits: [],
    drives: [],
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    faction_id: opts.faction ?? null,
    lastSeenAt: null,
  })

export const faction = (
  id: string,
  name: string,
  opts: { description?: string; keywords?: string[]; standing?: string } = {},
): Entity =>
  entityRow(id, 'faction', name, opts, opts.standing != null ? { standing: opts.standing } : {})

export const place = (
  id: string,
  name: string,
  opts: { description?: string; keywords?: string[]; parent?: string } = {},
): Entity => entityRow(id, 'location', name, opts, { parent_location_id: opts.parent ?? null })

export const happening = (
  id: string,
  title: string,
  opts: { description?: string; temporal?: string; occurredAtEntryId?: string } = {},
): Happening => ({
  id,
  branchId: BRANCH,
  title,
  description: opts.description ?? null,
  category: null,
  icon: null,
  temporal: opts.temporal ?? null,
  occurredAtEntryId: opts.occurredAtEntryId ?? null,
  commonKnowledge: 0,
  embeddingStale: 0,
  createdAt: AT,
  updatedAt: AT,
})

export const thread = (id: string, title: string, status: Thread['status']): Thread => ({
  id,
  branchId: BRANCH,
  title,
  description: null,
  category: null,
  icon: null,
  status,
  injectionMode: 'auto',
  triggeredAtEntryId: null,
  resolvedAtEntryId: null,
  embeddingStale: 0,
  createdAt: AT,
  updatedAt: AT,
})

/** kind is how a sees b; inverseKind how b sees a. */
export const relationship = (
  id: string,
  a: string,
  b: string,
  kind: string | null,
  inverseKind: string | null,
): CharacterRelationship => ({
  id,
  branchId: BRANCH,
  aId: a,
  bId: b,
  kind,
  inverseKind,
  createdAt: AT,
  updatedAt: AT,
})

type Turn = { kind: 'user_action' | 'ai_reply'; prose: string; scene?: string[]; location?: string }

export const action = (prose: string, scene?: Pick<Turn, 'scene' | 'location'>): Turn => ({
  kind: 'user_action',
  prose,
  ...scene,
})

export const narration = (prose: string, scene?: Pick<Turn, 'scene' | 'location'>): Turn => ({
  kind: 'ai_reply',
  prose,
  ...scene,
})

/** The window's entries from position 1, each turn's scene defaulting to the window's. */
export function entries(
  window: string,
  scene: { scene: string[]; location?: string },
  turns: readonly Turn[],
): StoryEntry[] {
  return turns.map((turn, i) => ({
    id: `entry_${window}_${i + 1}`,
    branchId: BRANCH,
    position: i + 1,
    kind: turn.kind,
    content: turn.prose,
    chapterId: null,
    metadata: entryMetadataSchema.parse({
      sceneEntities: turn.scene ?? scene.scene,
      currentLocationId: turn.location ?? scene.location ?? null,
      worldTime: i + 1,
    }),
    createdAt: AT + i,
  }))
}
