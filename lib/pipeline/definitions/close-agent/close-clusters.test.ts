import { describe, expect, it } from 'vitest'

import { cosine } from '@/lib/retrieval'

import { findClusters, type ClusterInput } from './close-clusters'

// Unit vectors in two dims (cosine refuses any other norm): two rows' cosine is the cosine of
// the gap between their angles.
const at = (angle: number): Float32Array => Float32Array.of(Math.cos(angle), Math.sin(angle))
const BASE = Float32Array.of(1, 0)
/** A vector whose cosine with BASE is `c`. */
const withCosine = (c: number): Float32Array => Float32Array.of(c, Math.sqrt(1 - c * c))

const WREN = 'char_wren'
const TOBIN = 'char_tobin'
const MIRA = 'char_mira'
const SILAS = 'char_silas'
const JORIN = 'char_jorin'
const ORREN = 'char_orren'
const PIP = 'char_pip'
const QUILL = 'char_quill'

// Within cosine's unit-norm tolerance, their double-precision dot product rounds to exactly 0.8.
const EXACT_A = Float32Array.of(7.947284075271455e-8, 1)
const EXACT_B = Float32Array.of(0.6000001430511475, 0.7999999523162842)

// 64 dims of +-0.125: unit-norm, and two vectors differing in k signs read cosine 1 - k/32 exactly.
const flipped = (...dims: number[]): Float32Array => {
  const v = new Float32Array(64).fill(0.125)
  for (const d of dims) v[d] = -0.125
  return v
}

const cast = (...ids: string[]): ReadonlySet<string> => new Set(ids)

/** A row that meets every criterion with any other made the same way, unless `over` says not. */
function row(id: string, over: Partial<ClusterInput> = {}): ClusterInput {
  return { id, vector: BASE, cast: cast(WREN, TOBIN), anchorIndex: 0, ...over }
}

type Pair = { name: string; a?: Partial<ClusterInput>; b: Partial<ClusterInput> }

describe('findClusters', () => {
  it('clusters two rows that meet all three criteria', () => {
    expect(findClusters([row('a'), row('b', { vector: withCosine(0.9), anchorIndex: 2 })])).toEqual(
      [['a', 'b']],
    )
  })

  it.each<Pair>([
    { name: 'a cosine of 0.79', b: { vector: withCosine(0.79) } },
    {
      name: 'a third of the smaller cast shared',
      a: { cast: cast(WREN, TOBIN, MIRA) },
      b: { cast: cast(WREN, SILAS, JORIN) },
    },
    {
      name: 'two fifths of the smaller cast shared',
      a: { cast: cast(WREN, TOBIN, MIRA, SILAS, JORIN) },
      b: { cast: cast(WREN, TOBIN, ORREN, PIP, QUILL) },
    },
    { name: 'anchors 4 entries apart', b: { anchorIndex: 4 } },
  ])('keeps apart two rows that fail only on $name', ({ a, b }) => {
    expect(findClusters([row('a', a), row('b', b)])).toEqual([])
  })

  it.each<Pair>([
    { name: 'a cosine of 0.81', b: { vector: withCosine(0.81) } },
    { name: 'a cosine of exactly 0.8', a: { vector: EXACT_A }, b: { vector: EXACT_B } },
    {
      name: 'exactly half the smaller cast shared',
      a: { cast: cast(WREN, TOBIN) },
      b: { cast: cast(WREN, MIRA) },
    },
    {
      name: 'the smaller cast wholly inside a larger one',
      a: { cast: cast(WREN) },
      b: { cast: cast(WREN, TOBIN, MIRA, SILAS) },
    },
    { name: 'anchors exactly 3 entries apart', b: { anchorIndex: 3 } },
  ])('clusters two rows at the edge: $name', ({ a, b }) => {
    expect(findClusters([row('a', a), row('b', b)])).toEqual([['a', 'b']])
  })

  it('has a cosine pair that lands exactly on the 0.8 edge', () => {
    expect(cosine(EXACT_A, EXACT_B)).toBe(0.8)
  })

  it('clusters two rows a redo re-derived at one entry', () => {
    expect(
      findClusters([
        row('h_redo_b', { anchorIndex: 5, vector: withCosine(0.97) }),
        row('h_redo_a', { anchorIndex: 5 }),
      ]),
    ).toEqual([['h_redo_a', 'h_redo_b']])
  })

  it('never clusters a row with no involvements', () => {
    expect(findClusters([row('a', { cast: cast() }), row('b', { cast: cast() })])).toEqual([])
    expect(findClusters([row('a', { cast: cast() }), row('b')])).toEqual([])
  })

  it('keeps out a row that fits one member but not another', () => {
    // c fits a (cosine 0.83) but not b (0.36), and b joined a: c stays out.
    const rows = [
      row('a', { vector: at(0), anchorIndex: 0 }),
      row('b', { vector: at(0.6), anchorIndex: 1 }),
      row('c', { vector: at(-0.6), anchorIndex: 2 }),
    ]

    expect(findClusters(rows)).toEqual([['a', 'b']])
  })

  it('joins the strongest pair first, so a row its weaker partner reaches stays out', () => {
    // a~b 0.825, b~c 0.999, a~c 0.796: b and c pair first, then a fits b but not c.
    const rows = [
      row('a', { vector: at(0), anchorIndex: 0 }),
      row('b', { vector: at(0.6), anchorIndex: 1 }),
      row('c', { vector: at(0.65), anchorIndex: 2 }),
    ]

    expect(findClusters(rows)).toEqual([['b', 'c']])
  })

  it('merges two clusters only when every cross pair fits', () => {
    // a~b 0.939 and c~d 0.999 pair first; b~c (0.921) bridges them, but a and c sit 0.75 rad
    // apart (cosine 0.73), so the clusters stay two.
    const rows = [
      row('a', { vector: at(0), anchorIndex: 0 }),
      row('b', { vector: at(0.35), anchorIndex: 1 }),
      row('c', { vector: at(0.75), anchorIndex: 2 }),
      row('d', { vector: at(0.8), anchorIndex: 3 }),
    ]

    expect(findClusters(rows)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('merges clusters whose every cross pair fits, listing the rows in anchor order', () => {
    // a~c 0.999 pairs first, then b joins both (0.969, 0.955): the cluster lists a, b, c.
    const rows = [
      row('c', { vector: at(0.05), anchorIndex: 2 }),
      row('a', { vector: at(0), anchorIndex: 0 }),
      row('b', { vector: at(0.3), anchorIndex: 1 }),
    ]

    expect(findClusters(rows)).toEqual([['a', 'b', 'c']])
  })

  it('checks a cross pair by its own two rows, never through a key another pair shares', () => {
    // hub fits all three leaves, the leaves fit none of each other: hub~p1 (0.999) pairs first,
    // and p2 can't join, though a sum-keyed lookup would read (p1, p2) as (p0, hub).
    const leaf = (id: string, angle: number, anchorIndex: number): ClusterInput =>
      row(id, { vector: at(angle), anchorIndex, cast: cast(id) })
    const rows = [
      leaf('p0', 0.4, 0),
      leaf('p1', 0.05, 1),
      leaf('p2', 0.2, 2),
      row('hub', { vector: at(0), anchorIndex: 3, cast: cast('p0', 'p1', 'p2') }),
    ]

    expect(findClusters(rows)).toEqual([['p1', 'hub']])
  })

  it('orders the clusters by their first row, not by which pair was strongest', () => {
    // The pair at entries 10 and 11 (cosine 1) forms before the pair at 0 and 1 (0.99).
    const rows = [
      row('p', { vector: BASE, anchorIndex: 10 }),
      row('q', { vector: BASE, anchorIndex: 11 }),
      row('a', { vector: at(0), anchorIndex: 0 }),
      row('b', { vector: at(0.14), anchorIndex: 1 }),
    ]

    expect(findClusters(rows)).toEqual([
      ['a', 'b'],
      ['p', 'q'],
    ])
  })

  describe('a tie in cosine', () => {
    // Every vector is BASE, so each qualifying pair reads cosine 1 and only the cast or the span
    // keeps a pair apart: the first pair walked decides which of two rival merges lands.
    it('goes to the pair whose earlier member has the smaller anchor', () => {
      const rows = [
        row('z', { anchorIndex: 0 }),
        row('m', { anchorIndex: 3 }),
        row('a', { anchorIndex: 6 }),
      ]

      expect(findClusters(rows)).toEqual([['z', 'm']])
    })

    it('goes, at one anchor, to the pair whose earlier member has the smaller id', () => {
      const rows = [
        row('n', { anchorIndex: 0, cast: cast(MIRA, SILAS) }),
        row('m', { anchorIndex: 0, cast: cast(WREN, TOBIN) }),
        row('z', { anchorIndex: 1, cast: cast(WREN, TOBIN, MIRA, SILAS) }),
      ]

      expect(findClusters(rows)).toEqual([['m', 'z']])
    })

    it('goes, with one earlier member, to the pair whose later member sorts first', () => {
      const rows = [
        row('a', { anchorIndex: 0, cast: cast(WREN, TOBIN, MIRA, SILAS) }),
        row('c', { anchorIndex: 2, cast: cast(MIRA, SILAS) }),
        row('b', { anchorIndex: 1, cast: cast(WREN, TOBIN) }),
      ]

      expect(findClusters(rows)).toEqual([['a', 'b']])
    })

    it('goes to the pair whose earlier member sorts first, though no row is shared', () => {
      // (r0,r1), (r0,r3) and (r1,r2) tie at 0.96875; (r0,r2) and (r1,r3) read 0.9375; r2 and r3
      // share no cast. (r0,r3) walks before (r1,r2): r3 joins {r0,r1}, and r2 then can't.
      const rows = [
        row('r0', { anchorIndex: 0, vector: flipped(), cast: cast(WREN, TOBIN, MIRA, SILAS) }),
        row('r1', { anchorIndex: 1, vector: flipped(0), cast: cast(WREN, TOBIN, MIRA, SILAS) }),
        row('r2', { anchorIndex: 2, vector: flipped(0, 2), cast: cast(WREN, TOBIN) }),
        row('r3', { anchorIndex: 3, vector: flipped(1), cast: cast(MIRA, SILAS) }),
      ]
      const [r0, r1, r2, r3] = rows.map(({ vector }) => vector)

      expect([cosine(r0, r1), cosine(r0, r3), cosine(r1, r2)]).toEqual([0.96875, 0.96875, 0.96875])
      expect([cosine(r0, r2), cosine(r1, r3)]).toEqual([0.9375, 0.9375])
      expect(findClusters(rows)).toEqual([['r0', 'r1', 'r3']])
    })
  })

  it('lists a cluster in anchor order, a tie by id', () => {
    const rows = [
      row('a', { anchorIndex: 2 }),
      row('n', { anchorIndex: 1 }),
      row('z', { anchorIndex: 0 }),
      row('m', { anchorIndex: 1 }),
    ]

    expect(findClusters(rows)).toEqual([['z', 'm', 'n', 'a']])
  })

  it('returns no cluster of one row, and none from no rows', () => {
    expect(findClusters([row('a')])).toEqual([])
    expect(findClusters([])).toEqual([])
  })
})
