import type { EntityRow, LoreRow } from './pools'

/**
 * retrieval.md → Three-sub-pool entity model. Retired has no framing, hence Partial.
 * The memory-blocks macro repeats these words; memory-blocks.test.ts pins the two
 * together.
 */
export const ENTITY_FRAMING: Partial<Record<EntityRow['status'], string>> = {
  active: 'currently elsewhere',
  staged: 'available to introduce',
}

// A blank field must not leave its separator behind: "Mira: " reads to the model as
// a truncated line, and the ranker charges the budget for it either way.
export const lines = (...parts: (string | null)[]): string =>
  parts.filter((p) => p !== null && p !== '').join('\n')

/**
 * The exact string the prompt carries for a retrieved entity, and the tokenizer's
 * input when its cost is computed. Do not inline it at call sites: keyword injection
 * seats the same row down a different path, and two formulas would diverge silently.
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
