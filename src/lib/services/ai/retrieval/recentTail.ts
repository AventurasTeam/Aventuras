/**
 * Recent Tail Split
 *
 * Dividing the un-chapterized tail of the story between the two ways the retrieval agent
 * can reach it: quoted directly in its prompt, or searchable with grep_chapters.
 *
 * The tail is the same set of entries in both cases -- `story.visibleEntries` and
 * `story.getUnchapterizedEntries()` are two derivations of `entries.slice(lastChapterEnd + 1)`
 * -- and the agent's prompt already contains it as RECENT SCENE. Handing the whole tail to
 * grep as well meant the tool could spend excerpt budget, and the agent could spend steps,
 * quoting back prose sitting a few hundred tokens higher up in the same prompt. On a story
 * just past a chapter cut, where the tail fits in the prompt entirely, *every* grep hit in
 * the tail was of that kind.
 *
 * So the tail is cut once, here, and each half goes to exactly one consumer. Nothing is
 * lost: the prompt keeps the most recent material, which is what a narrator turn is usually
 * about, and grep keeps everything the prompt had to leave out.
 *
 * Split on whole entries rather than on a character offset. The cap is about prompt size, so
 * a character count is the right budget, but half an entry in the prompt and the same half
 * again in the search corpus would reintroduce the overlap it exists to remove -- and leave
 * the agent reading a fragment that starts mid-sentence.
 */

import type { StoryEntry } from '$lib/types'

/** Separator `AgenticRetrievalService` joins entry content with, charged to the budget. */
const JOIN_LENGTH = 2

/**
 * Floor for lore management's use of this split.
 *
 * Next to the function it constrains rather than in `core/defaults.ts`: it guards a failure
 * mode and has no control in Advanced Settings, which is where that file's own rule puts it.
 * Higher than the retrieval side's floor because the pass is rare and deep -- five entries
 * is two full exchanges plus the action that opened the next.
 */
export const MIN_RECENT_ENTRIES_FOR_LORE = 5

export interface RecentTailSplit {
  /** Newest entries, quoted in the prompt. Never empty when `tail` is not. */
  shown: StoryEntry[]
  /** Older entries, reachable only through grep_chapters. */
  searchable: StoryEntry[]
}

/**
 * Fit as many of the newest entries as `maxChars` allows into `shown`, the rest into
 * `searchable`.
 *
 * `minEntries` is a floor the character budget cannot undercut, and it is not belt and
 * braces -- without it this function collapses on real prose. Entries are indivisible, so
 * one entry larger than the remaining budget ends the loop; the newest entry in a
 * generation turn is the player's action, typically under 100 characters, and the one
 * before it is a full narration. Measured on a 40-chapter story: entries averaged 2,688
 * characters against a 2,048 cap, so `shown` came back as the player's own action and
 * nothing else, and the agent's RECENT SCENE was a verbatim echo of the USER INPUT printed
 * two lines above it. It had no view of the present scene at all while being asked to
 * judge what the past should supply.
 *
 * A larger cap alone would not have fixed that -- it would have postponed it until the
 * prose grew. The floor is what makes the failure impossible rather than unlikely; the cap
 * still governs the cost above it.
 */
export function splitRecentTail(
  tail: StoryEntry[],
  maxChars: number,
  minEntries = 1,
): RecentTailSplit {
  if (tail.length === 0) return { shown: [], searchable: [] }

  const floor = Math.max(1, Math.min(minEntries, tail.length))

  let used = 0
  let firstShown = tail.length - 1

  for (let i = tail.length - 1; i >= 0; i--) {
    const cost = (tail[i].content?.length ?? 0) + (used > 0 ? JOIN_LENGTH : 0)
    const kept = tail.length - i
    // Over budget, but not yet at the floor: take it anyway. The floor wins, and it is the
    // only way the guarantee can hold when a single entry can exceed the whole budget.
    if (used > 0 && used + cost > maxChars && kept > floor) break
    used += cost
    firstShown = i
  }

  return { shown: tail.slice(firstShown), searchable: tail.slice(0, firstShown) }
}
