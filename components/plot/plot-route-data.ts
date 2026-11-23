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
 * A happening's committed link rows, from one branch's link reads. No happening (a thread, create
 * mode, nothing selected) returns one shared empty value, so the pane's draft baseline keeps its
 * identity.
 */
export function happeningLinksFor(
  happeningId: string | null,
  branchInvolvements: ReadonlyMap<string, HappeningInvolvement>,
  branchAwareness: ReadonlyMap<string, HappeningAwareness>,
): HappeningLinks {
  if (happeningId == null) return NO_LINKS
  return {
    involvements: [...branchInvolvements.values()].filter((l) => l.happeningId === happeningId),
    awareness: [...branchAwareness.values()].filter((l) => l.happeningId === happeningId),
  }
}
