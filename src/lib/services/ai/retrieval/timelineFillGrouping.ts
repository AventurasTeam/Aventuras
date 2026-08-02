/**
 * Pure helpers for grouping TimelineFillService static-mode queries by the chapters
 * they target. Kept dependency-free (no BaseAIService/settings) so the decision logic
 * is unit-testable on its own.
 */

import type { TimelineQuery } from '../sdk/schemas/timeline'

/** Resolve a query's explicit chapter list or numeric range into a flat chapter-number array. */
export function resolveQueryChapterNumbers(query: TimelineQuery): number[] {
  if (query.chapters && query.chapters.length > 0) {
    return query.chapters
  }
  if (query.startChapter !== undefined && query.endChapter !== undefined) {
    const numbers: number[] = []
    for (let i = query.startChapter; i <= query.endChapter; i++) {
      numbers.push(i)
    }
    return numbers
  }
  return []
}

/** Stable grouping key for a set of chapter numbers - same set, any order, same key. */
export function chapterNumbersKey(chapterNumbers: number[]): string {
  return [...chapterNumbers].sort((a, b) => a - b).join(',')
}

/** A set of chapters assembled once, and every question that can be answered from it. */
export interface ChapterCoverageGroup<T> {
  /** Union of the group's chapters -- the widest member's set. Ascending. */
  chapterNumbers: number[]
  items: T[]
}

/**
 * Group questions by the chapters they need, merging any question whose chapters are a
 * **subset** of another's into that wider group.
 *
 * Exact-key grouping was leaving the commonest overlap on the table: a question about
 * chapter 18 and one about chapters 17-19 were two groups, so the text of chapter 18 was
 * assembled, sent and paid for twice in the same turn. A subset is answerable from the
 * superset's content by construction -- it is strictly more of the same chapters -- so the
 * only thing the split bought was a second copy of the prompt.
 *
 * Strictly subsets, not any overlap. Unioning {17,18} with {18,19} would widen both groups
 * to three chapters and make every member pay for a chapter it did not ask about; the
 * saving is one chapter and the cost is spread over everyone.
 *
 * Widest first, so a wide set always exists as a group before the narrow ones that fold into
 * it. Ties break on the joined key, which keeps grouping deterministic for a given input.
 *
 * `canHostSubsets` is what keeps that reasoning true once a token budget enters the picture.
 * "A subset is answerable from the superset's content" holds only while the superset's
 * content is actually *sent whole*: `buildChapterRead` cuts a group's chapters off in
 * ascending order once the budget is spent, so a question about chapter 19 folded into
 * {17,18,19} can be answered from a read that stops inside chapter 18. Left on its own it
 * would have had the entire budget for chapter 19. The predicate is asked once per candidate
 * host, and a host that cannot fit its own chapters stops absorbing narrower questions --
 * they keep their own groups and their own full budget. Default: everything hosts, which is
 * the old behaviour.
 *
 * An *identical* set folds either way, budget or not. Two questions that resolve to the same
 * chapters get the same content and the same truncation whether they share a call or not, so
 * splitting them buys nothing and costs a whole extra call -- and the commonest case of it
 * is two open-ended questions, which both resolve to every chapter and so are never within
 * budget on a long story.
 */
export function groupByChapterCoverage<T extends { chapterNumbers: number[] }>(
  items: T[],
  canHostSubsets: (chapterNumbers: number[]) => boolean = () => true,
): ChapterCoverageGroup<T>[] {
  const sorted = [...items].sort(
    (a, b) =>
      b.chapterNumbers.length - a.chapterNumbers.length ||
      chapterNumbersKey(a.chapterNumbers).localeCompare(chapterNumbersKey(b.chapterNumbers)),
  )

  const groups: {
    chapters: Set<number>
    chapterNumbers: number[]
    key: string
    hosts: boolean
    items: T[]
  }[] = []

  for (const item of sorted) {
    const wanted = item.chapterNumbers
    // Deduped before the key is taken, so `[1, 1, 2]` and `[1, 2]` are recognised as the
    // same set. A key built from the raw list would miss that, and the two would be split
    // into groups whose assembled content is byte-identical.
    const chapterNumbers = [...new Set(wanted)].sort((a, b) => a - b)
    const key = chapterNumbersKey(chapterNumbers)
    const host = groups.find(
      (g) => g.key === key || (g.hosts && wanted.every((n) => g.chapters.has(n))),
    )
    if (host) {
      host.items.push(item)
    } else {
      groups.push({
        chapters: new Set(chapterNumbers),
        chapterNumbers,
        key,
        hosts: canHostSubsets(chapterNumbers),
        items: [item],
      })
    }
  }

  return groups.map((g) => ({ chapterNumbers: g.chapterNumbers, items: g.items }))
}
