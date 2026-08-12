/** The shape every list-result row renders as, regardless of what produced it. */
export type AssistListItem<P = unknown> = {
  /** Dedupe key and card heading. */
  name: string
  /** Condensed one-line preview under the heading. */
  detail: string
  /**
   * The producing call site's own row, carried through untouched so importing
   * does not have to reconstruct it from `name` / `detail` — those two are for
   * rendering and deduping only, and would silently drop any third field
   * (lore's `category`, and every per-kind field 3.6b's cast rows carry).
   * Required rather than optional: an omitted payload used to type-check and
   * only fail at import time, spreading `undefined` into the committed row.
   */
  payload: P
}

export type MarkedAssistListItem<P = unknown> = AssistListItem<P> & {
  /** Already present in the wizard's own list — checkbox renders disabled. */
  exists: boolean
}

function key(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * wizard.md → Pagination on list results: `Generate more` preserves already
 * imported rows, and case-insensitive name collisions show `(already exists)`.
 */
export function markExisting<P>(
  items: readonly AssistListItem<P>[],
  existingNames: readonly string[],
): MarkedAssistListItem<P>[] {
  const taken = new Set(existingNames.map(key))
  return items.map((item) => ({
    ...item,
    name: item.name.trim(),
    exists: taken.has(key(item.name)),
  }))
}

/** Append a fresh page to the accumulated result, first-occurrence wins. */
export function mergePages<P>(
  accumulated: readonly AssistListItem<P>[],
  page: readonly AssistListItem<P>[],
): AssistListItem<P>[] {
  const seen = new Set(accumulated.map((i) => key(i.name)))
  const merged = [...accumulated]
  for (const item of page) {
    const k = key(item.name)
    if (seen.has(k)) continue
    seen.add(k)
    merged.push(item)
  }
  return merged
}
