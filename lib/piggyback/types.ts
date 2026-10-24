import { z } from 'zod'

import type { Entity, EntryMetadata, VISUAL_CATEGORIES } from '@/lib/db'

// Mirrors CharacterState['visual']'s keys (lib/db/entities/entity-state-schema.ts →
// VISUAL_CATEGORIES) — the only categories a full-replace visual change can target.
export const VISUAL_CHANGE_TYPES = [
  'physique',
  'face',
  'hair',
  'eyes',
  'attire',
  'distinguishing',
] as const
export type VisualChangeType = (typeof VISUAL_CHANGE_TYPES)[number]

// Drift guard: must match entryMetadataSchema's stateReport enum (lib/db) — that schema
// never validates piggyback data, so the type check below is what actually catches drift.
// Type-only: a value import would drag the whole db barrel into scripts/mock-llm's plain Node.
type _VisualCategoriesMatch = [VisualChangeType] extends [(typeof VISUAL_CATEGORIES)[number]]
  ? [(typeof VISUAL_CATEGORIES)[number]] extends [VisualChangeType]
    ? true
    : never
  : never
const _visualChecks: [_VisualCategoriesMatch] = [true]
void _visualChecks

// Mirrors entity-state-schema.ts's `.max(500)` on a visual field and on a condition; parse.test.ts
// and bound-text.test.ts pin them.
export const VISUAL_TEXT_MAX = 500

// retrieval.md → Q4. Restated from lib/retrieval's MAX_EMITTED_QUERIES, which this module
// cannot value-import for the reason above; parse.test.ts pins them equal.
export const MAX_RETRIEVAL_QUERIES = 3

export type VisualChangeNote = { id: string; type: VisualChangeType; text: string }
/** A place's or an item's condition as it is now; it replaces the stored one whole. */
export type ConditionChange = { id: string; text: string }
/** `seq` is the tag's place among the block's item moves and drops: the order apply.ts follows. */
export type ItemTransfer = {
  id: string
  slot: 'equipped_items' | 'inventory'
  to?: string
  from?: string
  seq: number
}
/** A held item put down where the scene is; `seq` as on ItemTransfer. */
export type ItemDrop = { id: string; from?: string; seq: number }
export type StackableTransfer = { key: string; amount: number; to?: string; from?: string }
export type ParsedTransfers = {
  items: ItemTransfer[]
  stackables: StackableTransfer[]
  drops: ItemDrop[]
}

/** `parent`: a placeholder, handle or `top` as emitted; substituted, see SubstitutedStateBlock. */
export type NewLocationEmission = {
  handle: string
  name: string
  description: string
  parent?: string
  condition?: string
}
export type NewItemEmission = {
  handle: string
  name: string
  description: string
  condition?: string
}

export type ParsedStateBlock = {
  sceneEntities?: string[]
  currentLocation?: string
  worldTimeDelta?: number
  visualChanges?: VisualChangeNote[]
  conditions?: ConditionChange[]
  transfers?: ParsedTransfers
  summary?: string
  retrievalQueries?: string[]
  /** Creates this block declares; its other fields name them by `handle`. */
  newLocations?: NewLocationEmission[]
  newItems?: NewItemEmission[]
}

/** Every create has a bare, unique `new:` handle and a name. Minted only by `normalizeCreates`. */
export type NormalizedStateBlock = ParsedStateBlock & { readonly __brand: 'NormalizedStateBlock' }

/**
 * Placeholders swapped for ids: refs name only ids or declared handles, a transfer's item an item.
 * A create's `parent` may also be `TOP_LEVEL` or a raw undeclared/unresolved ref, which the planner
 * drops as `unresolved`. Minted only by `substitutePiggybackIds`.
 */
export type SubstitutedStateBlock = ParsedStateBlock & { readonly __brand: 'SubstitutedStateBlock' }

// `'state'` is the block-level failure: no block in a reply that owed one, an empty block (creates
// alone count as empty), or a cut-off one that declares a create.
export type ParseFieldFailure = { field: keyof ParsedStateBlock | 'state'; detail: string }

/**
 * An entry the fallback discarded before apply (piggyback.md → A bad ref in the two writers):
 * `unknown` names no listed entity or declared handle, `wrong-kind` one of a kind the field can't
 * hold, `unreadable` an entry the schema couldn't read. `ref` is as emitted.
 */
const DROPPED_REF_FIELDS = [
  'sceneEntities',
  'currentLocation',
  'visualChanges',
  'conditions',
  'transfers',
] as const

export const isDroppedRefField = (field: string): field is DroppedRef['field'] =>
  (DROPPED_REF_FIELDS as readonly string[]).includes(field)

export type DroppedRef = {
  field: (typeof DROPPED_REF_FIELDS)[number]
  ref?: string
  reason: 'unknown' | 'wrong-kind' | 'unreadable'
  detail: string
}

export type ParseStateBlockResult = {
  block: NormalizedStateBlock
  failures: ParseFieldFailure[]
  blockFound: boolean
  /** Creates dropped as malformed, or opened and never closed; 0 when the block was not found. */
  malformedCreates: number
  /** `<drop>`s that name a `to`, as emitted and kept out of the block: an item put down somewhere
   *  else than the scene stays prose. */
  dropsElsewhere: { id: string; to: string }[]
  /** Drops kept out of a block the stream cut off before its `<current_location>`: they land where
   *  the scene is, and the cut may have taken the place the scene moved to. */
  dropsCutOff: ItemDrop[]
}

type StateReport = NonNullable<EntryMetadata['stateReport']>
/** A `<new_location>`'s outcome; `parent`: id, `top`, as emitted if dropped, none if unplaced. */
export type NewLocationReport = NonNullable<StateReport['newLocations']>[number]
export type NewItemReport = NonNullable<StateReport['newItems']>[number]
export type ReportedDrop = NonNullable<NonNullable<StateReport['transfers']>['drops']>[number]
export type TurnCreatesReport = { newLocations: NewLocationReport[]; newItems: NewItemReport[] }

/**
 * A substituted block with every create handle resolved or removed, bar an uncreated item's as
 * `currentLocation`, which apply.ts rejects; so no create lists. Minted only by the per-turn planner
 * (`planTurnCreates`, `skipTurnCreates`).
 */
export type PlannedStateBlock = ParsedStateBlock & {
  newLocations?: never
  newItems?: never
  readonly __brand: 'PlannedStateBlock'
}

/** One turn's planned block and creates, which apply and report read together. */
export type PlannedTurn = {
  block: PlannedStateBlock
  /** The rows the turn's creates insert, looked up like stored rows. */
  createdRows: readonly Entity[]
  /** Rows a location create reused; a staged one is promoted like a staged scene member. */
  reusedIds: readonly string[]
  report: TurnCreatesReport
}

// `categoryRef` is the prompt-side placeholder (cat1, cat2…), not a category
// id — the emission map resolves it (lib/piggyback/suggestion-slots.ts).
//
// The single declaration of the chip shape a model returns, shared by the
// tagged parser and both structured surfaces. The .describe() strings are part
// of the prompt contract that ships to the model, so a second copy would let
// the two structured surfaces silently start asking for different things.
// Consumers differ only in array policy (.catch([]) or not), never in element.
export const suggestionRefSchema = z.object({
  categoryRef: z.string().describe('opaque category id from the prompt list, e.g. cat1'),
  text: z.string().describe("complete prose for the reader's next turn"),
})

export type SuggestionRef = z.infer<typeof suggestionRefSchema>

export type ParseSuggestionsBlockResult = {
  items: SuggestionRef[]
  blockFound: boolean
  failed: boolean
  /**
   * `<item>` tags the block opened but the parser could not turn into an entry:
   * no `category`, empty text, or never closed. They never reach `items`, so
   * `resolveSuggestionItems`' droppedCount cannot see them — without this a
   * partially malformed block is indistinguishable from a short one.
   */
  malformedCount: number
}
