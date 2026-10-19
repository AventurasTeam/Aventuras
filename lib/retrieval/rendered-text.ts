import type { EntityKind } from '@/lib/db'
import { oneLine } from '@/lib/text'
import type {
  CharacterStateView,
  EntityRef,
  EntityViews,
  HoldingView,
  KindedView,
} from '@/lib/world'

import type { EntityRow, LoreRow } from './pools'
import type { MeasuredEntity } from './types'

/**
 * A held item's id as the mirror measures it: as wide as a real placeholder, but one IdBiMap
 * never allocates (it counts from 1), so a custom pack printing `renderedText` hands the model
 * an id that fails substitution rather than resolving to another item.
 */
export const HELD_ITEM_ID_STAND_IN = 'i00'

/**
 * retrieval.md → Three-sub-pool entity model. A retired row has no framing, and an active
 * faction none either: it is never in a scene, so "currently elsewhere" says nothing about it.
 * The memory-blocks macro repeats these words; memory-blocks.test.ts pins the two together.
 */
export function entityFraming(kind: EntityKind, status: EntityRow['status']): string | null {
  if (status === 'staged') return 'available to introduce'
  return status === 'active' && kind !== 'faction' ? 'currently elsewhere' : null
}

// A blank field must not leave its separator behind: "Mira: " reads to the model as
// a truncated line, and the ranker charges the budget for it either way.
export const lines = (...parts: (string | null)[]): string =>
  parts.filter((p) => p !== null && p !== '').join('\n')

// Liquid's `blank`: nil, empty or whitespace-only.
const isBlank = (value: string | null): boolean => value === null || value.trim() === ''

/** A memory-blocks entity row's first line: `name (framing): description`. */
export function entityHead(
  row: Pick<EntityRow, 'kind' | 'name' | 'description' | 'status'>,
): string {
  const framing = entityFraming(row.kind, row.status)
  const head = framing === null ? row.name : `${row.name} (${framing})`
  return isBlank(row.description) ? head : `${head}: ${row.description}`
}

type ItemLineFields = Pick<HoldingView, 'name' | 'description' | 'condition'> & {
  equipped?: boolean
}

/** One `Holds:` or `Here:` line; `id` is the bracketed id, or null where the block shows none. */
export function itemLine(item: ItemLineFields, id: string | null): string {
  const description = oneLine(item.description ?? '')
  const condition = oneLine(item.condition ?? '')
  const head = `- ${id === null ? '' : `[${id}] `}${item.name}${item.equipped ? ' (equipped)' : ''}`
  const described = description === '' ? head : `${head}: ${description}`
  if (condition === '') return described
  const stop = description !== '' && /[.!?]$/.test(description) ? ' ' : '. '
  return `${described}${stop}Condition: ${condition}`
}

const VISUAL_LABELS = {
  physique: 'Physique',
  face: 'Face',
  hair: 'Hair',
  eyes: 'Eyes',
  attire: 'Attire',
  distinguishing: 'Distinguishing',
} as const satisfies Record<keyof CharacterStateView['visual'], string>

export type StateLineOptions = {
  /** Shown in scene or as the current location: no `Location:`, `Part of:` or `Held by:`. */
  here: boolean
  /** The id a held item is bracketed with, or null where the block brackets none. */
  heldId: ((id: string) => string) | null
  /** False keeps the `Holds:` label but not its item lines, for a caller pricing each item apart. */
  heldLines?: boolean
}

const labelled = (label: string, value: string | null | undefined): string[] =>
  value == null || isBlank(value) ? [] : [`${label}: ${value}`]

// A retired target is still the fact (the last place seen, a disbanded faction), so it's named,
// and marked so it doesn't read as current.
const refName = (ref: EntityRef | null): string | null =>
  ref === null ? null : ref.status === 'retired' ? `${ref.name} (retired)` : ref.name

/** The lines the bundled entity-state macro prints for an entity, in its order; the macro is the spec. */
export function entityStateLines(entity: KindedView, options: StateLineOptions): string[] {
  const { here, heldId } = options
  switch (entity.kind) {
    case 'character': {
      const s = entity.state
      const holds =
        s.holdings.length === 0
          ? []
          : [
              'Holds:',
              ...(options.heldLines === false
                ? []
                : s.holdings.map((h) => itemLine(h, heldId === null ? null : heldId(h.id)))),
            ]
      return [
        ...(here ? [] : labelled('Location', refName(s.location))),
        ...Object.entries(VISUAL_LABELS).flatMap(([key, label]) =>
          labelled(label, s.visual[key as keyof typeof VISUAL_LABELS]),
        ),
        ...labelled('Voice', s.voice),
        ...(s.traits.length > 0 ? [`Traits: ${s.traits.join('; ')}`] : []),
        ...(s.drives.length > 0 ? [`Drives: ${s.drives.join('; ')}`] : []),
        ...labelled('Faction', refName(s.faction)),
        ...holds,
        ...(s.stackables.length > 0
          ? [`Stackables: ${s.stackables.map((st) => `${st.key} ${st.amount}`).join(', ')}`]
          : []),
      ]
    }
    case 'location':
      return [
        ...labelled('Condition', entity.state.condition),
        ...(here ? [] : labelled('Part of', refName(entity.state.parent))),
      ]
    case 'item':
      return [
        ...labelled('Condition', entity.state.condition),
        ...(here ? [] : labelled('Location', refName(entity.state.location))),
        ...(here ? [] : labelled('Held by', refName(entity.state.holder))),
      ]
    case 'faction': {
      const members = entity.state.members.filter((m) => m.status !== 'retired')
      return [
        ...labelled('Standing', entity.state.standing),
        ...(entity.state.agenda.length > 0 ? [`Agenda: ${entity.state.agenda.join('; ')}`] : []),
        ...(members.length > 0 ? [`Members: ${members.map((m) => m.name).join(', ')}`] : []),
      ]
    }
  }
}

/** A source row paired with its view, the one object a seated row carries to the template. */
export function measuredEntity(
  row: Pick<EntityRow, 'id' | 'kind' | 'name' | 'description' | 'status'>,
  views: EntityViews,
): MeasuredEntity {
  return {
    kind: row.kind,
    name: row.name,
    description: row.description,
    status: row.status,
    state: views.of(row.id, row.kind),
  } as MeasuredEntity
}

/**
 * retrieval.md → Token estimation: a code mirror of the bundled memory-blocks row, minus its
 * `[id] ` prefix, with held items' ids measured as though piggyback fires. The tokenizer's input
 * for an entity's cost; memory-blocks.test.ts fails unless the macro renders exactly this. Do not
 * inline it at call sites: keyword injection seats the same row down a different path.
 */
export function entityRenderedText(entity: MeasuredEntity): string {
  return [
    entityHead(entity),
    ...entityStateLines(entity, { here: false, heldId: () => HELD_ITEM_ID_STAND_IN }),
  ].join('\n')
}

/** Lore's counterpart to entityRenderedText, shared for the same reason. */
export function loreRenderedText(row: Pick<LoreRow, 'title' | 'body'>): string {
  return lines(row.title, row.body)
}
