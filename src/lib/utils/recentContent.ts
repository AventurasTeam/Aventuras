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
  withRoles = false,
): string {
  // `slice(-0)` is `slice(0)` -- the whole array, not none of it. Every caller today is
  // bounded by a slider with a minimum of 2, or passes `entries.length`, so this never
  // fired; but the failure mode is a request carrying the entire story instead of nothing,
  // which is the worst possible direction for an off-by-nothing to go.
  if (count <= 0) return ''

  const sliced = entries.slice(-count)
  if (!withRoles) {
    return sliced.map((e) => e.content).join(separator)
  }

  return sliced.map((e) => `${roleLabel(e.type)}: ${e.content}`).join(separator)
}

/**
 * What each entry type is called when the text is labelled for a model to read.
 *
 * A `Record` over the union, so a new entry type is a compile error here rather than an
 * internal identifier appearing in a prompt. `retry` is an alternative narration and is
 * labelled as one: a model told it was a retry treats the re-roll as an event.
 */
const ROLE_LABELS: Record<StoryEntry['type'], string> = {
  user_action: '[Player Action]',
  narration: '[Narrator]',
  retry: '[Narrator]',
  system: '[System Note]',
}

/**
 * The fallback is not dead code: these rows come out of SQLite, where the column is a bare
 * `TEXT` and an older save can hold a type the union says is impossible. `[Narrator]` is
 * the safe guess — `[Player Action]` would assert the player said something.
 */
function roleLabel(type: StoryEntry['type']): string {
  return ROLE_LABELS[type] ?? ROLE_LABELS.narration
}

/** Separator for text that will be pattern-matched, not read. */
export const AS_HAYSTACK = ' ' as const

/** Separator for text a model will read as narrative. */
export const AS_PROSE = '\n\n' as const
