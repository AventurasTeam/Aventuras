import { z } from 'zod'

import {
  entityStateSchemaForKind,
  INJECTION_MODES,
  type CharacterState,
  type Entity,
  type EntityKind,
  type FactionState,
  type ItemState,
  type LocationState,
} from '@/lib/db'
import { t } from '@/lib/i18n'
import { ENTITY_STATUSES, stackableKey, stateOf } from '@/lib/world'

import { avtsEnvelope, type AvtsFile } from './envelope'
import { optionalText, priorityField, requiredText, termList } from './fields'
import { avtsFileName } from './file-name'

export type CharacterImportState = Omit<
  CharacterState,
  'current_location_id' | 'equipped_items' | 'inventory' | 'faction_id' | 'lastSeenAt'
>
export type LocationImportState = Omit<LocationState, 'parent_location_id'>
export type ItemImportState = Omit<ItemState, 'at_location_id'>
export type FactionImportState = FactionState

type EntityImportBase = {
  name: string
  description: string | null
  status: Entity['status']
  retiredReason: string | null
  injectionMode: Entity['injectionMode']
  tags: string[]
  keywords: string[]
  priority: number
}
export type EntityImport =
  | (EntityImportBase & { kind: 'character'; state: CharacterImportState })
  | (EntityImportBase & { kind: 'location'; state: LocationImportState })
  | (EntityImportBase & { kind: 'item'; state: ItemImportState })
  | (EntityImportBase & { kind: 'faction'; state: FactionImportState })

// entityStateSchemaForKind is typed as the union of the four; a key only one kind has picks it.
type StateSchemaWith<K extends string> = Extract<
  ReturnType<typeof entityStateSchemaForKind>,
  { shape: Record<K, unknown> }
>
const characterState = entityStateSchemaForKind('character') as StateSchemaWith<'lastSeenAt'>
const locationState = entityStateSchemaForKind('location') as StateSchemaWith<'parent_location_id'>
const itemState = entityStateSchemaForKind('item') as StateSchemaWith<'at_location_id'>
const factionState = entityStateSchemaForKind('faction') as StateSchemaWith<'standing'>

const STACKABLE_KEY_MAX = 40

// The key checks read only keys, so a mistyped count needn't hide them; a fractional
// count still does, as zod's `.int()` aborts explicitly and that overrides `when`.
const stackableKeyCheckGate = {
  when: (payload: { value: unknown }) =>
    typeof payload.value === 'object' && payload.value !== null,
}

// The pane draft refuses a blank, repeated or (once trimmed) over-long quantity name;
// saving would drop a blank one, or keep only one of a repeated one's counts.
const stackablesField = z
  .record(z.string(), characterState.shape.stackables.unwrap().valueType)
  .superRefine((stackables, ctx) => {
    const seen = new Set<string>()
    for (const raw of Object.keys(stackables)) {
      const key = stackableKey(raw)
      if (key === '') {
        ctx.addIssue({
          code: 'custom',
          path: [raw],
          message: t('common:avts.issue.stackableKeyRequired'),
        })
      } else if (raw.trim().length > STACKABLE_KEY_MAX) {
        ctx.addIssue({ code: 'custom', path: [raw], message: t('common:avts.issue.tooLong') })
      } else if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [raw],
          message: t('common:avts.issue.duplicateStackable'),
        })
      }
      seen.add(key)
    }
  }, stackableKeyCheckGate)
  .optional()

const characterImportState = characterState
  .omit({
    current_location_id: true,
    equipped_items: true,
    inventory: true,
    faction_id: true,
    lastSeenAt: true,
  })
  .extend({
    visual: characterState.shape.visual.default({}),
    traits: characterState.shape.traits.default([]),
    drives: characterState.shape.drives.default([]),
    stackables: stackablesField,
  })
const locationImportState = locationState.omit({ parent_location_id: true })
const itemImportState = itemState.omit({ at_location_id: true })

// A stored entity may carry a null state, and the raw JSON viewer shows it that way.
function stateField<T>(schema: z.ZodType<T>, empty: () => T) {
  return schema.nullish().transform((state) => state ?? empty())
}

const baseShape = {
  name: requiredText(() => t('common:avts.issue.nameRequired')),
  description: optionalText,
  status: z.enum(ENTITY_STATUSES),
  retiredReason: optionalText,
  injectionMode: z.enum(INJECTION_MODES),
  tags: termList,
  keywords: termList,
  priority: priorityField,
}

export const EntityImportSchema: z.ZodType<EntityImport> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('character'),
    ...baseShape,
    state: stateField(characterImportState, () => ({ visual: {}, traits: [], drives: [] })),
  }),
  z.object({
    kind: z.literal('location'),
    ...baseShape,
    state: stateField(locationImportState, () => ({})),
  }),
  z.object({
    kind: z.literal('item'),
    ...baseShape,
    state: stateField(itemImportState, () => ({})),
  }),
  z.object({
    kind: z.literal('faction'),
    ...baseShape,
    state: stateField(factionState, () => ({})),
  }),
])

const expectedKind: Record<EntityKind, () => string> = {
  character: () => t('common:avts.issue.expectedKind.character'),
  location: () => t('common:avts.issue.expectedKind.location'),
  item: () => t('common:avts.issue.expectedKind.item'),
  faction: () => t('common:avts.issue.expectedKind.faction'),
}

function namesAnEntityKind(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false
  return typeof value.kind === 'string' && Object.hasOwn(expectedKind, value.kind)
}

export type EntityImportOf<K extends EntityKind> = Extract<EntityImport, { kind: K }>

function narrowedTo<K extends EntityKind>(kind: K): z.ZodType<EntityImportOf<K>> {
  return EntityImportSchema.refine((entity): entity is EntityImportOf<K> => entity.kind === kind, {
    path: ['kind'],
    error: expectedKind[kind],
    // Zod skips a refine once a field has a type error; a wrong-slot file should say so regardless.
    when: (payload) => namesAnEntityKind(payload.value),
  })
}

const NARROWED: { [K in EntityKind]: z.ZodType<EntityImportOf<K>> } = {
  character: narrowedTo('character'),
  location: narrowedTo('location'),
  item: narrowedTo('item'),
  faction: narrowedTo('faction'),
}

/** The per-kind slot's schema: a wrong-kind payload fails with one issue at `kind`. */
export function entityImportSchemaFor<K extends EntityKind>(kind: K): z.ZodType<EntityImportOf<K>> {
  return NARROWED[kind]
}

function portableEntity(row: Entity): EntityImport {
  const base: EntityImportBase = {
    name: row.name,
    description: row.description,
    status: row.status,
    retiredReason: row.retiredReason,
    injectionMode: row.injectionMode,
    tags: [...row.tags],
    keywords: [...row.keywords],
    priority: row.priority,
  }
  switch (row.kind) {
    case 'character': {
      const { current_location_id, equipped_items, inventory, faction_id, lastSeenAt, ...state } =
        stateOf(row, 'character')
      return { kind: 'character', ...base, state }
    }
    case 'location': {
      const { parent_location_id, ...state } = stateOf(row, 'location')
      return { kind: 'location', ...base, state }
    }
    case 'item': {
      const { at_location_id, ...state } = stateOf(row, 'item')
      return { kind: 'item', ...base, state }
    }
    case 'faction':
      return { kind: 'faction', ...base, state: stateOf(row, 'faction') }
  }
}

export function entityExport(row: Entity, exportedAt: Date): AvtsFile {
  return {
    fileName: avtsFileName(row.kind, row.name),
    contents: avtsEnvelope('entity', portableEntity(row), exportedAt),
  }
}
