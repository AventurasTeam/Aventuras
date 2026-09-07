import { z } from 'zod'

import type { VISUAL_CATEGORIES } from '@/lib/db'

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

// Drift guard, both directions: the two lists must stay identical, since the parser
// validates against this one and entryMetadataSchema's stateReport enum validates
// against lib/db's own list directly. The type check below is what actually catches a
// divergence — entryMetadataSchema.parse() never runs on piggyback-authored data.
// Type-only on purpose — scripts/mock-llm reaches this module under plain Node, and a
// value import would drag the whole db barrel in behind it.
type _VisualCategoriesMatch = [VisualChangeType] extends [(typeof VISUAL_CATEGORIES)[number]]
  ? [(typeof VISUAL_CATEGORIES)[number]] extends [VisualChangeType]
    ? true
    : never
  : never
const _visualChecks: [_VisualCategoriesMatch] = [true]
void _visualChecks

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

export type ParsedStateBlock = {
  sceneEntities?: string[]
  currentLocation?: string
  worldTimeDelta?: number
  visualChanges?: VisualChangeNote[]
  transfers?: ParsedTransfers
  summary?: string
  retrievalQueries?: string[]
}

// `'state'` is the block-level failure: a <state> that parsed into no field at all.
export type ParseFieldFailure = { field: keyof ParsedStateBlock | 'state'; detail: string }

export type ParseStateBlockResult = {
  block: ParsedStateBlock
  failures: ParseFieldFailure[]
  blockFound: boolean
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
