import { describe, expect, it } from 'vitest'

import {
  chapterAgeIndex,
  chaptersOldAt,
  characterChaptersOld,
  EMPTY_CHAPTER_AGES,
  happeningAge,
  threadChaptersOld,
} from './chapters-old'
import { RANKER_DEFAULTS } from './constants'
import { rankPerType } from './ranker'
import type { Candidate } from './types'

/** Chapter n's one stamped entry. */
const inChapter = (n: number): string => `entry_ch${n}`
const OPEN = 'entry_open'
const GONE = 'entry_gone'

/** 59 closed chapters, so the open one is chapter 60. */
const AT_60 = chapterAgeIndex(
  Array.from({ length: 59 }, (_, i) => ({ sequence: i + 1, entryId: inChapter(i + 1) })),
)

describe('chapterAgeIndex', () => {
  it('numbers the open chapter one past the highest closed one', () => {
    expect(AT_60.current).toBe(60)
    expect(AT_60.sequenceOf.get(inChapter(3))).toBe(3)
    expect(AT_60.sequenceOf.has(OPEN)).toBe(false)
  })

  it('reads the highest sequence, not the last row', () => {
    const index = chapterAgeIndex([
      { sequence: 4, entryId: 'e4' },
      { sequence: 2, entryId: 'e2' },
    ])

    expect(index.current).toBe(5)
  })

  it('is empty, chapter 0, with no closed chapter', () => {
    expect(chapterAgeIndex([])).toEqual({ sequenceOf: new Map(), current: 0 })
    expect(EMPTY_CHAPTER_AGES.current).toBe(0)
  })
})

describe('chaptersOldAt', () => {
  it('counts from the open chapter: chapter 3 at chapter 60 is 57, the newest closed 1', () => {
    expect(chaptersOldAt(inChapter(3), AT_60)).toBe(57)
    expect(chaptersOldAt(inChapter(59), AT_60)).toBe(1)
  })

  it('reads 0 for an entry no closed chapter holds: the open region, or a dangling id', () => {
    expect(chaptersOldAt(OPEN, AT_60)).toBe(0)
    expect(chaptersOldAt(GONE, AT_60)).toBe(0)
  })

  it('reads null for no anchor', () => {
    expect(chaptersOldAt(null, AT_60)).toBeNull()
    expect(chaptersOldAt(undefined, AT_60)).toBeNull()
  })
})

describe('happeningAge', () => {
  it('ages a row from its learned_at_entry_id, with its own pin', () => {
    expect(
      happeningAge([{ learnedAtEntryId: inChapter(3), decayResistance: 0.3 }], null, AT_60),
    ).toEqual({ chaptersOld: 57, pinSignal: 0.3 })
  })

  // retrieval.md → Scoring function: recency_factor = exp(−λ × chapters_old × (1 − pin)).
  it("puts a chapter-3 row at chapter 60 under canon's decay: exp(-0.07 × 57 × 0.7)", () => {
    const aged = happeningAge(
      [{ learnedAtEntryId: inChapter(3), decayResistance: 0.3 }],
      null,
      AT_60,
    )
    const candidate: Candidate = {
      kind: 'happening',
      id: 'hap_1',
      displayName: 'The oath',
      renderedText: 'The oath',
      sims: [0.9, 0.9, 0.9],
      vector: Float32Array.from([1, 0]),
      ...aged,
      keywordHits: [],
      embeddingStale: false,
      commonKnowledge: false,
      occurredAtEntryId: null,
      awarenessIds: ['haw_1'],
    }

    const [trace] = rankPerType([candidate], 'happenings', 10_000, {
      params: RANKER_DEFAULTS,
      querySlots: ['action', 'digest', 'summary'],
      chapterRanges: new Map(),
      countTokens: () => 1,
    }).traces

    expect(trace?.chaptersOld).toBe(57)
    expect(trace?.recencyFactor).toBeCloseTo(Math.exp(-0.07 * 57 * 0.7), 3)
  })

  it('reads 0 for a row learned in the open region, and 1 for one in the newest closed chapter', () => {
    expect(happeningAge([{ learnedAtEntryId: OPEN, decayResistance: 0 }], null, AT_60)).toEqual({
      chaptersOld: 0,
      pinSignal: 0,
    })
    expect(
      happeningAge([{ learnedAtEntryId: inChapter(59), decayResistance: 0 }], null, AT_60),
    ).toEqual({ chaptersOld: 1, pinSignal: 0 })
  })

  // Aria: 57 × (1 − 0.9) = 5.7. Jorin: 2 × (1 − 0) = 2. The youngest age beside the largest pin,
  // from different rows, would read { 2, 0.9 }, a decay of 0.2 no row earns.
  it('lets the row decaying least decide, taking its age and its pin together', () => {
    const aria = { learnedAtEntryId: inChapter(3), decayResistance: 0.9 }
    const jorin = { learnedAtEntryId: inChapter(58), decayResistance: 0 }

    expect(happeningAge([aria, jorin], null, AT_60)).toEqual({ chaptersOld: 2, pinSignal: 0 })
    expect(happeningAge([jorin, aria], null, AT_60)).toEqual({ chaptersOld: 2, pinSignal: 0 })
  })

  it("ages a row with no anchor from the happening's occurred_at_entry_id", () => {
    expect(
      happeningAge([{ learnedAtEntryId: null, decayResistance: 0.5 }], inChapter(10), AT_60),
    ).toEqual({ chaptersOld: 50, pinSignal: 0.5 })
  })

  it('reads 0 for a row with no anchor on a happening with none either', () => {
    expect(happeningAge([{ learnedAtEntryId: null, decayResistance: 0.5 }], null, AT_60)).toEqual({
      chaptersOld: 0,
      pinSignal: 0.5,
    })
  })

  it("reads 0 for a dangling anchor rather than falling back to the happening's", () => {
    expect(
      happeningAge([{ learnedAtEntryId: GONE, decayResistance: 0 }], inChapter(10), AT_60),
    ).toEqual({ chaptersOld: 0, pinSignal: 0 })
  })

  it('reads a null pin as 0', () => {
    expect(
      happeningAge([{ learnedAtEntryId: inChapter(50), decayResistance: null }], null, AT_60),
    ).toEqual({ chaptersOld: 10, pinSignal: 0 })
  })

  // 10 × (1 − 0.5) = 5 = 5 × (1 − 0): an equal decay goes to the larger pin.
  it('breaks a tie on decay toward the larger pin', () => {
    const pinned = { learnedAtEntryId: inChapter(50), decayResistance: 0.5 }
    const recent = { learnedAtEntryId: inChapter(55), decayResistance: 0 }

    expect(happeningAge([recent, pinned], null, AT_60)).toEqual({ chaptersOld: 10, pinSignal: 0.5 })
    expect(happeningAge([pinned, recent], null, AT_60)).toEqual({ chaptersOld: 10, pinSignal: 0.5 })
  })

  // Two hard pins decay 0 whatever their age: the tie goes to the smaller age.
  it('breaks a tie on decay and pin toward the smaller age', () => {
    const older = { learnedAtEntryId: inChapter(30), decayResistance: 1 }
    const newer = { learnedAtEntryId: inChapter(56), decayResistance: 1 }

    expect(happeningAge([older, newer], null, AT_60)).toEqual({ chaptersOld: 4, pinSignal: 1 })
    expect(happeningAge([newer, older], null, AT_60)).toEqual({ chaptersOld: 4, pinSignal: 1 })
  })

  it('ages nothing with no row', () => {
    expect(happeningAge([], inChapter(3), AT_60)).toEqual({ chaptersOld: 0, pinSignal: 0 })
  })

  it('ages nothing with no closed chapter, keeping the largest pin', () => {
    expect(
      happeningAge(
        [
          { learnedAtEntryId: 'e1', decayResistance: 0.3 },
          { learnedAtEntryId: null, decayResistance: 0.6 },
        ],
        'e2',
        EMPTY_CHAPTER_AGES,
      ),
    ).toEqual({ chaptersOld: 0, pinSignal: 0.6 })
  })
})

describe('characterChaptersOld', () => {
  const lastSeenIn = (entryId: string) => ({ entryId, locationId: null, worldTime: 0 })

  it('ages a character from the entry it was last seen at', () => {
    expect(characterChaptersOld(lastSeenIn(inChapter(59)), AT_60)).toBe(1)
    expect(characterChaptersOld(lastSeenIn(inChapter(3)), AT_60)).toBe(57)
  })

  it('reads 0 for one last seen in the open region', () => {
    expect(characterChaptersOld(lastSeenIn(OPEN), AT_60)).toBe(0)
  })

  it('reads 0 for a character never seen, or for no character', () => {
    expect(characterChaptersOld(null, AT_60)).toBe(0)
    expect(characterChaptersOld(undefined, AT_60)).toBe(0)
  })

  it('reads 0 with no closed chapter', () => {
    expect(characterChaptersOld(lastSeenIn('e1'), EMPTY_CHAPTER_AGES)).toBe(0)
  })
})

describe('threadChaptersOld', () => {
  it('ages a thread from the entry it resolved or failed at', () => {
    expect(threadChaptersOld(inChapter(58), AT_60)).toBe(2)
  })

  it('reads 0 for no resolved ref, or one in the open region', () => {
    expect(threadChaptersOld(null, AT_60)).toBe(0)
    expect(threadChaptersOld(OPEN, AT_60)).toBe(0)
  })

  it('reads 0 with no closed chapter', () => {
    expect(threadChaptersOld('e1', EMPTY_CHAPTER_AGES)).toBe(0)
  })
})
