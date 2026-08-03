/**
 * Grep Sampling
 *
 * Choosing which excerpts to return when a search matches more than fits in one result.
 *
 * This replaces offset paging. Paging assumed a caller that would walk the pages, and
 * language models are poor at exactly that: they either stop after page one and answer
 * from a partial view, or loop through pages burning the iteration budget. Worse, "page
 * one" was the first N in chapter order -- the *oldest* matches, which is usually the
 * least useful slice of a story.
 *
 * So instead of a window into the list, return a spread across it: every chapter that
 * matched keeps its count, the excerpt budget is shared out so no matching chapter is
 * invisible, and within a chapter the chosen excerpts are spaced out rather than taken
 * from the front. To go deeper the caller narrows with chapterNumbers, which is a better
 * instrument than an offset anyway.
 *
 * Pure and deterministic -- no randomness, so the same search always samples the same way
 * and a repeated call is genuinely a repeat.
 */

export interface SampledGroup<T> {
  chapterNumber: number
  matches: T[]
}

/** Evenly spaced indexes into a list of `length`, always including the first. */
function spreadIndexes(length: number, take: number): number[] {
  if (take <= 0) return []
  if (take >= length) return Array.from({ length }, (_, i) => i)
  // A single slot takes the first mention: it is where a thread is usually introduced,
  // and it is the one an agent can most easily follow up on by narrowing the search.
  if (take === 1) return [0]

  const step = (length - 1) / (take - 1)
  const picked = new Set<number>()
  for (let i = 0; i < take; i++) picked.add(Math.round(i * step))

  // Rounding can collide on short lists; backfill so `take` slots are never wasted.
  for (let i = 0; picked.size < take && i < length; i++) picked.add(i)

  return [...picked].sort((a, b) => a - b)
}

/**
 * Share `limit` excerpt slots across groups.
 *
 * Two regimes, chosen by whether covering every matching group is *achievable* at all:
 *
 * - **`groups <= limit`** — cover everything. One slot each first, so a chapter with a
 *   single mention is never hidden behind one with fifty, then hand the rest out one at a
 *   time, densest group first, skipping any already fully shown.
 * - **`groups > limit`** — coverage is impossible whatever we do, so do not pay for it.
 *   Share the slots out in proportion to each group's hit count (largest remainder), which
 *   spends the budget where the term actually concentrates.
 *
 * The second regime exists because of what the first one did when it could not succeed.
 * Measured on a real run: `"rune"`, 120 hits across 28 chapters, 20 slots. Handing one
 * slot to each of the 20 densest exhausted the budget before a single group could get a
 * second, so the chapter with 28 hits and the chapter with 1 were shown identically -- 8
 * chapters still got nothing, and the agent, unable to answer from 20 unrelated fragments,
 * fell back to two `query_chapter` calls costing 51% of the whole turn. Proportional
 * allocation gives that search 4 excerpts from the densest chapter and 2 from the next.
 *
 * Nothing is hidden by either regime: every matching group is still returned with its full
 * count, and `omittedChapters` names the ones that got no excerpt.
 *
 * Ties go to the later chapter throughout: recent story is more often what a question is
 * about, and `-1` (the un-chapterized tail) is the latest of all.
 */
function allocate<T>(
  groups: SampledGroup<T>[],
  limit: number,
  weightOf: (match: T) => number,
): Map<number, number> {
  const allocation = new Map<number, number>()
  if (limit <= 0) return allocation

  const recencyNumber = (n: number) => (n === -1 ? Number.POSITIVE_INFINITY : n)
  const weigh = (g: SampledGroup<T>) => g.matches.reduce((n, m) => n + weightOf(m), 0)

  const ranked = groups
    .filter((g) => g.matches.length > 0)
    .map((group) => ({ group, weight: weigh(group) }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        recencyNumber(b.group.chapterNumber) - recencyNumber(a.group.chapterNumber),
    )
  if (ranked.length === 0) return allocation

  let remaining = limit

  if (ranked.length <= limit) {
    // Coverage is achievable, and it is worth having: one each, then density.
    for (const { group } of ranked) {
      allocation.set(group.chapterNumber, 1)
      remaining--
    }
  } else {
    // Coverage is out of reach. Largest remainder on the hit counts: floor everyone's
    // exact share, then give the leftover slots to the largest fractions. `ranked` is
    // already in density order, so a tie in the fraction resolves the same way as
    // everywhere else in this function.
    const total = ranked.reduce((n, r) => n + r.weight, 0) || ranked.length
    // A group's share is a fraction of its own weight, but the *cap* is how many passages it
    // actually has -- a chapter whose mentions all merged into two passages cannot show
    // three. So the floor is clamped here, and whatever that frees goes round again below.
    const shares = ranked.map(({ group, weight }) => {
      const exact = (weight * limit) / total
      const floor = Math.min(Math.floor(exact), group.matches.length)
      return { group, floor, remainder: exact - Math.floor(exact) }
    })

    for (const share of shares) {
      if (share.floor > 0) allocation.set(share.group.chapterNumber, share.floor)
      remaining -= share.floor
    }

    for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
      if (remaining === 0) break
      const current = allocation.get(share.group.chapterNumber) ?? 0
      if (current >= share.group.matches.length) continue
      allocation.set(share.group.chapterNumber, current + 1)
      remaining--
    }
  }

  // Whatever is still unspent -- groups that filled up, or rounding -- goes round the
  // densest first until nothing more can be placed.
  while (remaining > 0) {
    const before = remaining
    for (const { group } of ranked) {
      if (remaining === 0) break
      const current = allocation.get(group.chapterNumber) ?? 0
      if (current >= group.matches.length) continue
      allocation.set(group.chapterNumber, current + 1)
      remaining--
    }
    // Every group is full: nothing left to hand out.
    if (remaining === before) break
  }

  return allocation
}

export interface SampleResult<T> {
  groups: SampledGroup<T>[]
  /** True when anything was left out. */
  sampled: boolean
  /** Chapters that matched but got no excerpt in this sample. */
  omittedChapters: number[]
}

/**
 * Reduce each group's matches to a representative sample totalling at most `limit`.
 *
 * Every group is returned, including ones sampled down to nothing: their counts are what
 * tell the caller the match exists at all, and dropping the group entirely would make a
 * chapter look clean when it is not.
 */
export function sampleMatches<T>(
  groups: SampledGroup<T>[],
  limit: number,
  /**
   * How much a match counts for when sharing the budget out. Defaults to one per passage.
   *
   * The grep tool passes each passage's *hit* count instead, and the difference is not
   * cosmetic. `findTextMatches` merges neighbouring matching paragraphs into one passage, so
   * counting passages penalises exactly the chapters where a term concentrates: twenty
   * mentions in one scene collapse to two passages and weigh two, while four scattered
   * mentions weigh four. That is the inverse of what the proportional branch exists to do.
   */
  weightOf: (match: T) => number = () => 1,
): SampleResult<T> {
  const total = groups.reduce((n, g) => n + g.matches.length, 0)

  if (total <= limit) {
    return { groups, sampled: false, omittedChapters: [] }
  }

  const allocation = allocate(groups, limit, weightOf)
  const omittedChapters: number[] = []

  const sampledGroups = groups.map((group) => {
    const take = allocation.get(group.chapterNumber) ?? 0
    if (group.matches.length > 0 && take === 0) omittedChapters.push(group.chapterNumber)

    return {
      ...group,
      matches: spreadIndexes(group.matches.length, take).map((i) => group.matches[i]),
    }
  })

  return { groups: sampledGroups, sampled: true, omittedChapters }
}
