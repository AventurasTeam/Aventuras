declare const DedupeKeyBrand: unique symbol

/**
 * Normalized identity for list dedupe, selection, and the `(already exists)`
 * mark. Branded so the suggestion side and the already-authored side cannot be
 * built by different rules and silently stop matching — the only ways in are
 * `nameKey` and `composeKey`, both of which normalize.
 */
export type DedupeKey = string & { readonly [DedupeKeyBrand]: true }

/** The shape every list-result row renders as, regardless of what produced it. */
export type AssistListItem<P = unknown> = {
  /** Card heading; also the prompt-facing exclusion string on `Generate more`. */
  name: string
  /** Condensed one-line preview under the heading. */
  detail: string
  /**
   * Dedupe/selection identity for callers whose rows are only unique within a
   * scope (name alone is ambiguous). Falls back to the row's name when omitted.
   */
  dedupeKey?: DedupeKey
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

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

/** Identity for rows whose name alone is unique. */
export function nameKey(name: string): DedupeKey {
  return normalizeKey(name) as DedupeKey
}

/**
 * Build a `dedupeKey` for rows whose name is only unique within a scope (e.g. a
 * cast kind). Each half is normalized separately — normalizing the joined string
 * only would leave a padded name as interior whitespace.
 */
export function composeKey(scope: string, name: string): DedupeKey {
  return `${normalizeKey(scope)}:${normalizeKey(name)}` as DedupeKey
}

/** The identity a list row dedupes, selects, and keys on. */
export function itemKey(item: Pick<AssistListItem, 'name' | 'dedupeKey'>): DedupeKey {
  return normalizeKey(item.dedupeKey ?? item.name) as DedupeKey
}

/**
 * wizard.md → Pagination on list results: `Generate more` preserves already
 * imported rows, and case-insensitive name collisions show `(already exists)`.
 */
export function markExisting<P>(
  items: readonly AssistListItem<P>[],
  existingKeys: readonly DedupeKey[],
): MarkedAssistListItem<P>[] {
  const taken = new Set<string>(existingKeys.map(normalizeKey))
  return items.map((item) => ({
    ...item,
    name: item.name.trim(),
    exists: taken.has(itemKey(item)),
  }))
}

/** Append a fresh page to the accumulated result, first-occurrence wins. */
export function mergePages<P>(
  accumulated: readonly AssistListItem<P>[],
  page: readonly AssistListItem<P>[],
): AssistListItem<P>[] {
  const seen = new Set(accumulated.map(itemKey))
  const merged = [...accumulated]
  for (const item of page) {
    const k = itemKey(item)
    if (seen.has(k)) continue
    seen.add(k)
    merged.push(item)
  }
  return merged
}
