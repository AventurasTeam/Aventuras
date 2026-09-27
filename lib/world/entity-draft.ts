import { z } from 'zod'

import {
  emptyEntityState,
  INJECTION_MODES,
  type CharacterState,
  type Entity,
  type EntityKind,
  type EntityStateByKind,
} from '@/lib/db'

import { WORLD_ISSUE } from './issues'

/** `entities.status`, in the Settings select's order. */
export const ENTITY_STATUSES = [
  'active',
  'staged',
  'retired',
] as const satisfies readonly Entity['status'][]

// Drift guard, both directions: `satisfies` above only proves ENTITY_STATUSES stays inside
// Entity['status']; this closes the other side so a status the column adds can't go missing
// from the Settings select without failing here first.
type _StatusesMatch = [Entity['status']] extends [(typeof ENTITY_STATUSES)[number]]
  ? [(typeof ENTITY_STATUSES)[number]] extends [Entity['status']]
    ? true
    : never
  : never
const _statusesMatchCheck: [_StatusesMatch] = [true]
void _statusesMatchCheck

/** A committed relationship seen from one character (the store's `RelationshipView`). */
export type RelationshipLink = {
  rowId: string
  otherId: string
  selfToOther: string | null
  otherToSelf: string | null
}

// data-model.md → Soft caps: the Zod degradation bounds the state schema enforces.
const text = (max: number) => z.string().max(max, WORLD_ISSUE.tooLong)
const list = z.array(z.string()).max(50, WORLD_ISSUE.tooLong)

const baseShape = {
  name: z.string().trim().min(1, WORLD_ISSUE.nameRequired),
  description: z.string(),
  status: z.enum(ENTITY_STATUSES),
  retiredReason: z.string(),
  injectionMode: z.enum(INJECTION_MODES),
  keywords: z.array(z.string()),
  tags: z.array(z.string()),
  priority: z
    .number({ error: WORLD_ISSUE.priorityRange })
    .int(WORLD_ISSUE.priorityRange)
    .min(0, WORLD_ISSUE.priorityRange)
    .max(100, WORLD_ISSUE.priorityRange),
}

export type EntityBaseDraft = z.infer<z.ZodObject<typeof baseShape>>

/** data-model.md → Stackable items: keys are stored lowercase. */
export function stackableKey(raw: string): string {
  return raw.trim().toLowerCase()
}

const stackableSchema = z.object({
  key: z.string().trim().min(1, WORLD_ISSUE.stackableKeyRequired).max(40, WORLD_ISSUE.tooLong),
  count: z
    .number({ error: WORLD_ISSUE.stackableCount })
    .int(WORLD_ISSUE.stackableCount)
    .min(0, WORLD_ISSUE.stackableCount),
})

// `when` runs the check past one row's type error (a cleared count), so it sees raw rows.
const stackablesSchema = z.array(stackableSchema).superRefine(
  (rows, ctx) => {
    const keys = new Set<string>()
    rows.forEach((row, index) => {
      if (row == null) return
      if (typeof row.key !== 'string') return
      const key = stackableKey(row.key)
      // A blank key is its own issue (stackableKeyRequired), never a duplicate.
      if (key === '') return
      if (keys.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: WORLD_ISSUE.duplicateStackable,
        })
      }
      keys.add(key)
    })
  },
  { when: (payload) => Array.isArray(payload.value) },
)

const relationshipSchema = z.object({
  /** The card's identity across form resets: the committed row id, or a draft-only id. */
  cardKey: z.string(),
  otherId: z.string({ error: WORLD_ISSUE.characterRequired }).min(1, WORLD_ISSUE.characterRequired),
  selfToOther: z.string(),
  otherToSelf: z.string(),
})

const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === ''

// Same `when` as the quantities: a cleared picker leaves a row's otherId null.
const relationshipsSchema = z.array(relationshipSchema).superRefine(
  (rows, ctx) => {
    const others = new Set<string>()
    rows.forEach((row, index) => {
      if (row == null) return
      // data-model.md → character_relationships CHECK: kind or inverse_kind must be non-null.
      if (isBlank(row.selfToOther) && isBlank(row.otherToSelf)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'selfToOther'],
          message: WORLD_ISSUE.relationshipPovRequired,
        })
      }
      if (typeof row.otherId !== 'string' || row.otherId === '') return
      if (others.has(row.otherId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'otherId'],
          message: WORLD_ISSUE.duplicateRelationship,
        })
      }
      others.add(row.otherId)
    })
  },
  { when: (payload) => Array.isArray(payload.value) },
)

export const characterDraftSchema = z.object({
  ...baseShape,
  visualPhysique: text(500),
  visualFace: text(500),
  visualHair: text(500),
  visualEyes: text(500),
  visualAttire: text(500),
  visualDistinguishing: text(500),
  traits: list,
  drives: list,
  voice: text(2000),
  currentLocationId: z.string().nullable(),
  factionId: z.string().nullable(),
  equippedItems: z.array(z.string()),
  inventory: z.array(z.string()),
  stackables: stackablesSchema,
  relationships: relationshipsSchema,
})
export type CharacterDraft = z.infer<typeof characterDraftSchema>
export type StackableDraft = CharacterDraft['stackables'][number]
export type RelationshipDraft = CharacterDraft['relationships'][number]

export const locationDraftSchema = z.object({
  ...baseShape,
  parentLocationId: z.string().nullable(),
  condition: text(500),
})
export type LocationDraft = z.infer<typeof locationDraftSchema>

export const itemDraftSchema = z.object({
  ...baseShape,
  atLocationId: z.string().nullable(),
  condition: text(500),
})
export type ItemDraft = z.infer<typeof itemDraftSchema>

export const factionDraftSchema = z.object({ ...baseShape, standing: text(500), agenda: list })
export type FactionDraft = z.infer<typeof factionDraftSchema>

/** Draft field ↔ `CharacterState.visual` key, in canon order. */
export const VISUAL_DRAFT_FIELDS = [
  ['visualPhysique', 'physique'],
  ['visualFace', 'face'],
  ['visualHair', 'hair'],
  ['visualEyes', 'eyes'],
  ['visualAttire', 'attire'],
  ['visualDistinguishing', 'distinguishing'],
] as const satisfies readonly (readonly [keyof CharacterDraft, keyof CharacterState['visual']])[]

/** A row's state over its kind's empty state, so a null or partial stored state still reads. */
export function stateOf<K extends EntityKind>(
  row: Pick<Entity, 'state'> | null,
  kind: K,
): EntityStateByKind[K] {
  return { ...emptyEntityState(kind), ...(row?.state ?? {}) } as EntityStateByKind[K]
}

function baseDraftFrom(row: Entity | null): EntityBaseDraft {
  return {
    name: row?.name ?? '',
    description: row?.description ?? '',
    status: row?.status ?? 'active',
    retiredReason: row?.retiredReason ?? '',
    injectionMode: row?.injectionMode ?? 'auto',
    keywords: [...(row?.keywords ?? [])],
    tags: [...(row?.tags ?? [])],
    priority: row?.priority ?? 0,
  }
}

/** Null `row` is create mode, which starts with no relationships. */
export function characterDraftFrom(
  row: Entity | null,
  relationships: readonly RelationshipLink[],
): CharacterDraft {
  const state = stateOf(row, 'character')
  return {
    ...baseDraftFrom(row),
    visualPhysique: state.visual.physique ?? '',
    visualFace: state.visual.face ?? '',
    visualHair: state.visual.hair ?? '',
    visualEyes: state.visual.eyes ?? '',
    visualAttire: state.visual.attire ?? '',
    visualDistinguishing: state.visual.distinguishing ?? '',
    traits: [...state.traits],
    drives: [...state.drives],
    voice: state.voice ?? '',
    currentLocationId: state.current_location_id ?? null,
    factionId: state.faction_id ?? null,
    equippedItems: [...state.equipped_items],
    inventory: [...state.inventory],
    stackables: Object.entries(state.stackables ?? {}).map(([key, count]) => ({ key, count })),
    relationships:
      row == null
        ? []
        : relationships.map((r) => ({
            cardKey: r.rowId,
            otherId: r.otherId,
            selfToOther: r.selfToOther ?? '',
            otherToSelf: r.otherToSelf ?? '',
          })),
  }
}

export function locationDraftFrom(row: Entity | null): LocationDraft {
  const state = stateOf(row, 'location')
  return {
    ...baseDraftFrom(row),
    parentLocationId: state.parent_location_id ?? null,
    condition: state.condition ?? '',
  }
}

export function itemDraftFrom(row: Entity | null): ItemDraft {
  const state = stateOf(row, 'item')
  return {
    ...baseDraftFrom(row),
    atLocationId: state.at_location_id ?? null,
    condition: state.condition ?? '',
  }
}

export function factionDraftFrom(row: Entity | null): FactionDraft {
  const state = stateOf(row, 'faction')
  return {
    ...baseDraftFrom(row),
    standing: state.standing ?? '',
    agenda: [...(state.agenda ?? [])],
  }
}
