import type { StoryEntry } from '$lib/types'

/**
 * The last `count` story entries, flattened into one string.
 *
 * Six call sites built this by hand, and the separator is the reason it looks like a
 * pointless wrapper until you compare them:
 *
 * - `' '` when the result is a **haystack**, fed to `entityNameMatches` to find out which
 *   entities are mentioned. The separator only has to stop the last word of one entry
 *   fusing with the first word of the next.
 * - `'\n\n'` when the result is **prose in a prompt**, read by a model. Paragraph breaks
 *   are the difference between a scene and a wall of text.
 *
 * Passing it explicitly makes that choice visible at every call site, which repeating the
 * three-line chain did not: the two spellings sat in different files and read as an
 * inconsistency rather than a decision.
 */
export function recentContent(
  entries: StoryEntry[],
  count: number,
  separator: ' ' | '\n\n',
): string {
  // `slice(-0)` is `slice(0)` -- the whole array, not none of it. Every caller today is
  // bounded by a slider with a minimum of 2, or passes `entries.length`, so this never
  // fired; but the failure mode is a request carrying the entire story instead of nothing,
  // which is the worst possible direction for an off-by-nothing to go.
  if (count <= 0) return ''

  return entries
    .slice(-count)
    .map((e) => e.content)
    .join(separator)
}

/** Separator for text that will be pattern-matched, not read. */
export const AS_HAYSTACK = ' ' as const

/** Separator for text a model will read as narrative. */
export const AS_PROSE = '\n\n' as const
