import { describe, it, expect } from 'vitest'
import { sampleMatches } from './grepSampling'

/** A group of `count` labelled excerpts, so we can see *which* ones were kept. */
function group(chapterNumber: number, count: number) {
  return {
    chapterNumber,
    matches: Array.from({ length: count }, (_, i) => `ch${chapterNumber}-${i}`),
  }
}

const shownIn = (groups: { chapterNumber: number; matches: string[] }[], chapterNumber: number) =>
  groups.find((g) => g.chapterNumber === chapterNumber)!.matches

describe('sampleMatches — under the limit', () => {
  it('returns everything untouched', () => {
    const groups = [group(1, 2), group(2, 3)]
    const result = sampleMatches(groups, 10)

    expect(result.sampled).toBe(false)
    expect(result.groups).toBe(groups)
    expect(result.omittedChapters).toEqual([])
  })

  it('treats exactly the limit as not sampled', () => {
    expect(sampleMatches([group(1, 5)], 5).sampled).toBe(false)
  })
})

describe('sampleMatches — over the limit', () => {
  it('never exceeds the limit', () => {
    const result = sampleMatches([group(1, 40), group(2, 40), group(3, 40)], 12)
    expect(result.sampled).toBe(true)
  })

  it('gives every matching chapter at least one excerpt before any gets a second', () => {
    // The whole point: a chapter with one mention must not be buried by one with fifty.
    const result = sampleMatches([group(1, 50), group(2, 1), group(3, 1)], 5)

    expect(shownIn(result.groups, 2)).toHaveLength(1)
    expect(shownIn(result.groups, 3)).toHaveLength(1)
    expect(result.omittedChapters).toEqual([])
  })

  it('gives denser chapters more of the leftover budget', () => {
    const result = sampleMatches([group(1, 90), group(2, 10)], 11)

    expect(shownIn(result.groups, 1).length).toBeGreaterThan(shownIn(result.groups, 2).length)
  })

  it('spreads a chapter’s excerpts across it rather than taking the first ones', () => {
    const result = sampleMatches([group(1, 9)], 3)

    // First, middle, last — not ch1-0, ch1-1, ch1-2.
    expect(shownIn(result.groups, 1)).toEqual(['ch1-0', 'ch1-4', 'ch1-8'])
  })

  it('keeps groups it could not sample, so their counts stay visible', () => {
    // More matching chapters than slots: coverage is impossible, but a chapter that
    // vanished entirely would read as "nothing here".
    const result = sampleMatches([group(1, 1), group(2, 1), group(3, 1), group(4, 1)], 2)

    expect(result.groups).toHaveLength(4)
    expect(result.omittedChapters).toHaveLength(2)
  })

  it('spends the budget on the densest chapter once covering them all is out of reach', () => {
    // Previously this gave ch2 and ch3 one each: coverage first, always. But with more
    // matching chapters than slots the coverage is never achieved anyway -- ch1 got
    // nothing either way -- so paying for it bought a second unrelated fragment instead
    // of a second look at the chapter the term actually concentrates in.
    const result = sampleMatches([group(1, 1), group(2, 9), group(3, 1)], 2)

    expect(shownIn(result.groups, 2)).toHaveLength(2)
    expect(result.omittedChapters).toEqual([1, 3])
  })

  it('still covers everything when coverage is achievable, even at exactly the limit', () => {
    // The boundary between the two regimes. Three groups, three slots: one each, and the
    // 90-hit chapter gets no more than the 1-hit chapter.
    const result = sampleMatches([group(1, 90), group(2, 1), group(3, 1)], 3)

    expect(shownIn(result.groups, 1)).toHaveLength(1)
    expect(shownIn(result.groups, 2)).toHaveLength(1)
    expect(shownIn(result.groups, 3)).toHaveLength(1)
  })

  it('shares proportionally to hit counts once past that boundary', () => {
    // The shape measured on a real run: "rune", 120 hits across 28 chapters, 20 slots.
    // The old allocator gave all 28 one slot each until the budget ran out, so the
    // 28-hit chapter and the 1-hit chapter were shown identically.
    const groups = [
      group(32, 28),
      group(18, 16),
      group(-1, 9),
      group(3, 5),
      group(7, 5),
      group(16, 5),
      group(31, 5),
      group(36, 5),
      group(11, 4),
      group(13, 4),
      group(39, 4),
      group(2, 3),
      group(9, 3),
      group(10, 3),
      group(17, 3),
      group(8, 2),
      group(15, 2),
      group(28, 2),
      group(35, 2),
      group(38, 2),
      group(1, 1),
      group(4, 1),
      group(5, 1),
      group(19, 1),
      group(20, 1),
      group(23, 1),
      group(25, 1),
      group(40, 1),
    ]
    const result = sampleMatches(groups, 20)
    expect(shownIn(result.groups, 32).length).toBeGreaterThanOrEqual(4)
    expect(shownIn(result.groups, 18).length).toBeGreaterThanOrEqual(2)
    // The densest chapter must now be strictly better served than a one-mention chapter.
    expect(shownIn(result.groups, 32).length).toBeGreaterThan(shownIn(result.groups, 40).length)
  })

  it('never returns a group more excerpts than it has, in either regime', () => {
    // Proportional shares are fractions of a group's own hit count, so they cannot exceed
    // it -- but the leftover rounds hand slots out on top of them, and those must respect
    // the ceiling. One dense group among many sparse ones exercises both passes.
    const groups = [group(1, 3), ...Array.from({ length: 30 }, (_, i) => group(i + 2, 1))]
    const result = sampleMatches(groups, 20)

    for (const g of result.groups) {
      const original = groups.find((o) => o.chapterNumber === g.chapterNumber)!
      expect(g.matches.length).toBeLessThanOrEqual(original.matches.length)
    }
  })

  it('never allocates a group more excerpts than it has', () => {
    const result = sampleMatches([group(1, 1), group(2, 100)], 20)

    expect(shownIn(result.groups, 1)).toHaveLength(1)
  })

  it('is deterministic, so a repeated search really is a repeat', () => {
    const build = () => [group(1, 30), group(2, 7), group(3, 13)]
    expect(sampleMatches(build(), 9)).toEqual(sampleMatches(build(), 9))
  })
})

describe('sampleMatches — edges', () => {
  it('handles no groups', () => {
    expect(sampleMatches([], 10)).toEqual({
      groups: [],
      sampled: false,
      omittedChapters: [],
    })
  })

  it('ignores groups that matched nothing when sharing the budget', () => {
    const result = sampleMatches([group(1, 0), group(2, 10)], 4)

    expect(shownIn(result.groups, 1)).toEqual([])
    expect(shownIn(result.groups, 2)).toHaveLength(4)
    expect(result.omittedChapters).toEqual([])
  })

  it('shows nothing, rather than crashing, on a zero budget', () => {
    const result = sampleMatches([group(1, 5)], 0)
    expect(result.omittedChapters).toEqual([1])
  })
})

describe('sampleMatches — weighting', () => {
  const group = (chapterNumber: number, hits: number[]) => ({
    chapterNumber,
    matches: hits.map((h) => ({ hits: h })),
  })

  it('shares the budget by hits, not by how many passages they merged into', () => {
    // Chapter 1: 20 mentions that merged into 2 passages. Chapter 2: 4 scattered mentions.
    // Coverage is out of reach at limit 3, so the proportional branch runs.
    const groups = [group(1, [10, 10]), group(2, [1, 1, 1, 1])]
    const result = sampleMatches(groups, 3, (m) => m.hits)

    const shown = (n: number) =>
      result.groups.find((g) => g.chapterNumber === n)?.matches.length ?? 0

    // By hits the dense chapter is 20 against 4, so it takes what it can hold (2 passages)
    // and the leftover goes to the other; weighting by passages would have inverted this.
    expect(shown(1)).toBe(2)
    expect(shown(2)).toBe(1)
  })

  it('defaults to one per passage, leaving the generic behaviour unchanged', () => {
    const groups = [group(1, [10, 10]), group(2, [1, 1, 1, 1])]
    const result = sampleMatches(groups, 3)

    const shown = (n: number) =>
      result.groups.find((g) => g.chapterNumber === n)?.matches.length ?? 0

    expect(shown(1) + shown(2)).toBe(3)
    expect(shown(2)).toBeGreaterThanOrEqual(shown(1))
  })

  it('never allocates a group more passages than it has', () => {
    const groups = [group(1, [50]), group(2, [1]), group(3, [1])]
    const result = sampleMatches(groups, 2, (m) => m.hits)

    for (const g of result.groups) {
      const original = groups.find((o) => o.chapterNumber === g.chapterNumber)!
      expect(g.matches.length).toBeLessThanOrEqual(original.matches.length)
    }
  })
})
