import type { EntityRow, LoreRow } from './pools'

/**
 * Canon frames two of the three sub-pools (retrieval.md → Three-sub-pool entity
 * model), so the model reads an active pool row as elsewhere rather than present
 * and a staged one as introducible rather than as cast. Retired has no framing,
 * hence Partial. The memory-blocks macro repeats these words for pinned rows,
 * which never reach the ranker; memory-blocks.test.ts pins the two together.
 */
export const ENTITY_FRAMING: Partial<Record<EntityRow['status'], string>> = {
  active: 'currently elsewhere',
  staged: 'available to introduce',
}

// A blank field must not leave its separator behind: a null description renders
// "Mira: " to the model, which reads as a truncated line rather than an absent
// one, and the ranker charges the budget for it either way.
export const lines = (...parts: (string | null)[]): string =>
  parts.filter((p) => p !== null && p !== '').join('\n')

/**
 * The exact string the prompt carries for a retrieved entity, and the tokenizer's
 * input when its cost is computed. Shared rather than inlined at each call site
 * because keyword injection seats the same row down a different path
 * (retrieval.md → Keyword injection): two formulas would let one entity cost and
 * read differently depending on which path won, with nothing to fail.
 */
export function entityRenderedText(
  row: Pick<EntityRow, 'name' | 'description' | 'status'>,
): string {
  const framing = ENTITY_FRAMING[row.status]
  const head = framing === undefined ? row.name : `${row.name} (${framing})`
  return row.description ? `${head}: ${row.description}` : head
}

/** Lore's counterpart to entityRenderedText, shared for the same reason. */
export function loreRenderedText(row: Pick<LoreRow, 'title' | 'body'>): string {
  return lines(row.title, row.body)
}
