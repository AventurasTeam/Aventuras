import { describe, expect, it } from 'vitest'

import { foldMergeLinks, MERGED_SOURCE_MAX, type LinkRows } from './happening-tools'

type AwarenessRow = LinkRows['awareness'][number]

// Entry positions on the branch; entry_gone has none, as an anchor a rollback took.
const POSITIONS = new Map([
  ['entry_a', 1],
  ['entry_b', 2],
  ['entry_c', 3],
  ['entry_d', 4],
])
const positionOf = (entryId: string): number | undefined => POSITIONS.get(entryId)

const links = (over: Partial<LinkRows> = {}): LinkRows => ({
  involvements: [],
  awareness: [],
  ...over,
})

let rowCount = 0
const aware = (
  characterId: string,
  over: Partial<Omit<AwarenessRow, 'id' | 'characterId'>> = {},
): AwarenessRow => ({
  id: `haw_${characterId}_${++rowCount}`,
  characterId,
  learnedAtEntryId: null,
  decayResistance: null,
  retrievalCount: 0,
  source: null,
  ...over,
})
const involved = (entityId: string, role: string | null) => ({
  id: `hinv_${entityId}_${++rowCount}`,
  entityId,
  role,
})

describe('foldMergeLinks', () => {
  it('gives two absorbed rows naming one character one upsert: max decay, earliest learned_at, summed count', () => {
    const fold = foldMergeLinks(
      links({
        awareness: [
          aware('wren', {
            learnedAtEntryId: 'entry_c',
            decayResistance: 0.4,
            retrievalCount: 2,
            source: 'crossed with Tobin',
          }),
        ],
      }),
      [
        links({
          awareness: [
            aware('wren', {
              learnedAtEntryId: 'entry_b',
              decayResistance: 0.7,
              retrievalCount: 3,
              source: 'saw the light',
            }),
          ],
        }),
        links({
          awareness: [
            aware('wren', {
              learnedAtEntryId: 'entry_d',
              decayResistance: 0.5,
              retrievalCount: 4,
              source: 'crossed with Tobin',
            }),
          ],
        }),
      ],
      positionOf,
    )

    expect(fold.awareness).toEqual([
      {
        characterId: 'wren',
        learnedAtEntryId: 'entry_b',
        decayResistance: 0.7,
        retrievalCount: 9,
        source: 'crossed with Tobin; saw the light',
      },
    ])
  })

  it('creates one awareness for a character only the absorbed rows hold, an earlier anchor listed later winning', () => {
    const fold = foldMergeLinks(
      links(),
      [
        links({ awareness: [aware('mara', { learnedAtEntryId: 'entry_c', retrievalCount: 1 })] }),
        links({
          awareness: [
            aware('mara', {
              learnedAtEntryId: 'entry_b',
              decayResistance: 0.2,
              retrievalCount: 2,
              source: 'heard the haggling',
            }),
          ],
        }),
      ],
      positionOf,
    )

    expect(fold.awareness).toEqual([
      {
        characterId: 'mara',
        learnedAtEntryId: 'entry_b',
        decayResistance: 0.2,
        retrievalCount: 3,
        source: 'heard the haggling',
      },
    ])
  })

  it("gives two absorbed rows involving one entity one create with the first one's role, and none for an entity keep has", () => {
    const fold = foldMergeLinks(
      links({ involvements: [involved('tobin', 'ferryman')] }),
      [
        links({ involvements: [involved('tobin', 'witness'), involved('mara', 'watcher')] }),
        links({ involvements: [involved('mara', 'onlooker'), involved('wren', null)] }),
      ],
      positionOf,
    )

    expect(fold.involvements).toEqual([
      { entityId: 'mara', role: 'watcher' },
      { entityId: 'wren', role: null },
    ])
  })

  it("leaves a character only keep holds alone, and writes none for a fold that restates keep's row", () => {
    const fold = foldMergeLinks(
      links({
        awareness: [
          aware('tobin', {
            learnedAtEntryId: 'entry_a',
            decayResistance: 0.3,
            source: 'poled the boat',
          }),
          aware('wren', {
            learnedAtEntryId: 'entry_a',
            decayResistance: 0.9,
            retrievalCount: 5,
            source: 'seen',
          }),
        ],
      }),
      [
        links({
          awareness: [
            aware('wren', { learnedAtEntryId: 'entry_c', decayResistance: 0.2, source: 'seen' }),
          ],
        }),
      ],
      positionOf,
    )

    expect(fold).toEqual({ involvements: [], awareness: [] })
  })

  it('ranks a null learned_at and a null decay below any value, and an anchor off the branch below one on it', () => {
    const fold = foldMergeLinks(
      links({
        awareness: [
          aware('wren'),
          aware('mara', { learnedAtEntryId: 'entry_gone', decayResistance: 0.6 }),
          aware('tobin', { learnedAtEntryId: 'entry_c' }),
        ],
      }),
      [
        links({
          awareness: [
            aware('wren', { learnedAtEntryId: 'entry_gone', decayResistance: 0 }),
            aware('mara', { learnedAtEntryId: 'entry_d' }),
            aware('tobin', { learnedAtEntryId: 'entry_gone', retrievalCount: 1 }),
          ],
        }),
      ],
      positionOf,
    )

    expect(fold.awareness).toEqual([
      {
        characterId: 'wren',
        learnedAtEntryId: 'entry_gone',
        decayResistance: 0,
        retrievalCount: 0,
        source: null,
      },
      {
        characterId: 'mara',
        learnedAtEntryId: 'entry_d',
        decayResistance: 0.6,
        retrievalCount: 0,
        source: null,
      },
      {
        characterId: 'tobin',
        learnedAtEntryId: 'entry_c',
        decayResistance: null,
        retrievalCount: 1,
        source: null,
      },
    ])
  })

  it("joins distinct sources in first-seen order, keep's first, skipping blanks and repeats", () => {
    const fold = foldMergeLinks(
      links({ awareness: [aware('wren', { source: 'crossed with Tobin; saw the light' })] }),
      [
        links({ awareness: [aware('wren', { source: '  saw the light ', retrievalCount: 1 })] }),
        links({ awareness: [aware('wren', { source: '' })] }),
        links({ awareness: [aware('wren', { source: 'heard the bell' })] }),
        links({ awareness: [aware('wren', { source: 'crossed with Tobin' })] }),
      ],
      positionOf,
    )

    expect(fold.awareness).toEqual([
      {
        characterId: 'wren',
        learnedAtEntryId: null,
        decayResistance: null,
        retrievalCount: 1,
        source: 'crossed with Tobin; saw the light; heard the bell',
      },
    ])
  })

  it('joins a later source only while the join stays within MERGED_SOURCE_MAX, and never cuts a source', () => {
    expect(MERGED_SOURCE_MAX).toBe(120)
    const long = 'A'.repeat(100)
    const joined = foldMergeLinks(
      links({ awareness: [aware('wren', { source: long })] }),
      [
        links({ awareness: [aware('wren', { source: 'short one', retrievalCount: 1 })] }),
        links({ awareness: [aware('wren', { source: 'B'.repeat(20) })] }),
        links({ awareness: [aware('wren', { source: 'tiny' })] }),
      ],
      positionOf,
    )
    expect(joined.awareness[0]?.source).toBe(`${long}; short one; tiny`)
    expect(joined.awareness[0]?.source).toHaveLength(117)

    const over = 'C'.repeat(130)
    const kept = foldMergeLinks(
      links({ awareness: [aware('mara', { source: over })] }),
      [links({ awareness: [aware('mara', { source: 'more', retrievalCount: 1 })] })],
      positionOf,
    )
    expect(kept.awareness).toEqual([
      {
        characterId: 'mara',
        learnedAtEntryId: null,
        decayResistance: null,
        retrievalCount: 1,
        source: over,
      },
    ])
  })

  it('keeps the earlier-listed anchor when neither one has a position', () => {
    const fold = foldMergeLinks(
      links({ awareness: [aware('wren', { learnedAtEntryId: 'entry_gone' })] }),
      [
        links({
          awareness: [aware('wren', { learnedAtEntryId: 'entry_lost', retrievalCount: 1 })],
        }),
      ],
      positionOf,
    )

    expect(fold.awareness[0]?.learnedAtEntryId).toBe('entry_gone')
  })

  it("writes a fold that differs from keep's row in the decay alone, or in the source alone", () => {
    const fold = foldMergeLinks(
      links({
        awareness: [
          aware('wren', { decayResistance: 0.3, source: 'seen' }),
          aware('mara', { decayResistance: 0.3, source: 'heard' }),
        ],
      }),
      [
        links({
          awareness: [
            aware('wren', { decayResistance: 0.9, source: 'seen' }),
            aware('mara', { decayResistance: 0.3, source: 'told' }),
          ],
        }),
      ],
      positionOf,
    )

    expect(fold.awareness).toEqual([
      {
        characterId: 'wren',
        learnedAtEntryId: null,
        decayResistance: 0.9,
        retrievalCount: 0,
        source: 'seen',
      },
      {
        characterId: 'mara',
        learnedAtEntryId: null,
        decayResistance: 0.3,
        retrievalCount: 0,
        source: 'heard; told',
      },
    ])
  })

  it('joins a source that lands exactly on MERGED_SOURCE_MAX and skips one a character past it', () => {
    const base = 'A'.repeat(MERGED_SOURCE_MAX - 5)
    const fold = foldMergeLinks(
      links({
        awareness: [aware('wren', { source: base }), aware('mara', { source: base })],
      }),
      [
        links({
          awareness: [
            aware('wren', { source: 'abc' }),
            aware('mara', { source: 'abcd', retrievalCount: 1 }),
          ],
        }),
      ],
      positionOf,
    )

    expect(fold.awareness).toEqual([
      {
        characterId: 'wren',
        learnedAtEntryId: null,
        decayResistance: null,
        retrievalCount: 0,
        source: `${base}; abc`,
      },
      {
        characterId: 'mara',
        learnedAtEntryId: null,
        decayResistance: null,
        retrievalCount: 1,
        source: base,
      },
    ])
  })

  it("stands a keep source whole, padding and all, so a merge that adds nothing restates keep's row", () => {
    const fold = foldMergeLinks(
      links({ awareness: [aware('wren', { source: ' padded ' })] }),
      [links({ awareness: [aware('wren', { source: 'padded' })] })],
      positionOf,
    )

    expect(fold.awareness).toEqual([])
  })
})
