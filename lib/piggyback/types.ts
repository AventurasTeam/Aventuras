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

// Mirrors entity-state-schema.ts's visual field `.max(500)`; parse.test.ts pins the pair.
export const VISUAL_TEXT_MAX = 500

// retrieval.md → Q4. Restated from lib/retrieval's MAX_EMITTED_QUERIES, which this module
// cannot value-import for the reason above; parse.test.ts pins them equal.
export const MAX_RETRIEVAL_QUERIES = 3

export type VisualChangeNote = { id: string; type: VisualChangeType; text: string }
export type ItemTransfer = {
  id: string
  slot: 'equipped_items' | 'inventory'
  to?: string
  from?: string
}
export type StackableTransfer = { key: string; amount: number; to?: string; from?: string }
export type ParsedTransfers = { items: ItemTransfer[]; stackables: StackableTransfer[] }

/** `parent` is a placeholder or another create's handle as emitted; an id once substituted. */
export type NewLocationEmission = {
  handle: string
  name: string
  description: string
  parent?: string
}
export type NewItemEmission = { handle: string; name: string; description: string }

export type ParsedStateBlock = {
  sceneEntities?: string[]
  currentLocation?: string
  worldTimeDelta?: number
  visualChanges?: VisualChangeNote[]
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
 * A normalized block whose placeholders are entity ids and whose refs name only ids or declared
 * handles. Minted only by `substitutePiggybackIds`.
 */
export type SubstitutedStateBlock = ParsedStateBlock & { readonly __brand: 'SubstitutedStateBlock' }

// `'state'` is the block-level failure: no block in a reply that owed one, an empty block, or a
// cut-off one that declares a create.
export type ParseFieldFailure = { field: keyof ParsedStateBlock | 'state'; detail: string }

export type ParseStateBlockResult = {
  block: NormalizedStateBlock
  failures: ParseFieldFailure[]
  blockFound: boolean
  /** Creates dropped as malformed, or opened and never closed; 0 when the block was not found. */
  malformedCreates: number
}

type StateReport = NonNullable<EntryMetadata['stateReport']>
/** A `<new_location>` and its outcome; `parent` is the resolved id, or as emitted when dropped. */
export type NewLocationReport = NonNullable<StateReport['newLocations']>[number]
export type NewItemReport = NonNullable<StateReport['newItems']>[number]
export type TurnCreatesReport = { newLocations: NewLocationReport[]; newItems: NewItemReport[] }

/**
 * A substituted block with every create handle resolved or removed, so no create lists. Minted only
 * by the per-turn planner (`planTurnCreates`, `skipTurnCreates`).
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
