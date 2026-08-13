import type { StoryEntry } from '$lib/types'

/**
 * The last `count` story entries, flattened into one string.
 *
 * The separator says what the result is for, and every call site states it:
 *
 * - `' '` for a **haystack**, fed to `entityNameMatches`. It only has to stop the last word
 *   of one entry fusing with the first of the next.
 * - `'\n\n'` for **prose in a prompt**, read by a model.
 */
export interface RecentContentOptions {
  /** Prefix each entry with who produced it. */
  roles?: boolean
  /** Stamp each entry with the in-story time it began, when it carries one. */
  time?: boolean
  /** Applied to each entry's content before it is labelled and joined. */
  transform?: (content: string) => string
}

export function recentContent(
  entries: StoryEntry[],
  count: number,
  separator: ' ' | '\n\n',
  options: RecentContentOptions = {},
): string {
  // `slice(-0)` is `slice(0)` -- the whole array, not none of it. Every caller today is
  // bounded by a slider with a minimum of 2, or passes `entries.length`, so this never
  // fired; but the failure mode is a request carrying the entire story instead of nothing,
  // which is the worst possible direction for an off-by-nothing to go.
  if (count <= 0) return ''

  const { roles = false, time = false, transform } = options

  return entries
    .slice(-count)
    .map((e) => {
      const content = transform ? transform(e.content) : e.content
      // Joined rather than concatenated: the time alone must not open the line on a space.
      const prefix = [roles ? roleLabel(e.type) : '', time ? entryTime(e) : '']
        .filter(Boolean)
        .join(' ')
      return prefix ? `${prefix}: ${content}` : content
    })
    .join(separator)
}

/** The in-story clock an entry started at, as a parenthetical, or nothing if it has none. */
function entryTime(entry: StoryEntry): string {
  const t = entry.metadata?.timeStart
  if (!t) return ''
  const hh = String(t.hours).padStart(2, '0')
  const mm = String(t.minutes).padStart(2, '0')
  return `(at Y${t.years}D${t.days} ${hh}:${mm})`
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
