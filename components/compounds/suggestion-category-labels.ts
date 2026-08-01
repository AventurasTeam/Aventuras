/**
 * The category-label validity rule, in a leaf module so the editor and its hosts
 * share one implementation. Kept out of the editor file because importing that
 * pulls in RN-Web chrome, which the node test project cannot load.
 */

type LabeledRow = { id: string; label: string }

/** The identity two labels collide on. */
export function categoryLabelKey(label: string): string {
  return label.trim().toLowerCase()
}

export function findDuplicateLabelIds(rows: readonly LabeledRow[]): ReadonlySet<string> {
  const seen = new Map<string, string[]>()
  for (const row of rows) {
    const key = categoryLabelKey(row.label)
    if (key.length === 0) continue
    const ids = seen.get(key) ?? []
    ids.push(row.id)
    seen.set(key, ids)
  }
  const dups = new Set<string>()
  for (const ids of seen.values()) {
    if (ids.length > 1) for (const id of ids) dups.add(id)
  }
  return dups
}
