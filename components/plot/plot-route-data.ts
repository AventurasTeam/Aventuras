import type { HappeningAwareness, HappeningInvolvement } from '@/lib/db'
import type { HappeningLinks } from '@/lib/plot'

/** The branch's category values for the Autocomplete: trimmed, blank-free, deduped, sorted. */
export function distinctCategories(rows: readonly { category: string | null }[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    const category = row.category?.trim()
    if (category) seen.add(category)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

const NO_LINKS: HappeningLinks = { involvements: [], awareness: [] }

/**
 * A happening's committed link rows. No happening (a thread, create mode, nothing selected)
 * returns one shared empty value, so the pane's draft baseline keeps its identity.
 */
export function happeningLinksFor(
  happeningId: string | null,
  branchId: string,
  involvements: ReadonlyMap<string, HappeningInvolvement>,
  awareness: ReadonlyMap<string, HappeningAwareness>,
): HappeningLinks {
  if (happeningId == null) return NO_LINKS
  return {
    involvements: [...involvements.values()].filter(
      (l) => l.branchId === branchId && l.happeningId === happeningId,
    ),
    awareness: [...awareness.values()].filter(
      (l) => l.branchId === branchId && l.happeningId === happeningId,
    ),
  }
}
