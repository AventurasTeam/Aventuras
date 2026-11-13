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

  it('never clusters a temporal row, which has no anchor', () => {
    expect(findClusters([row('a', { anchorIndex: null }), row('b')])).toEqual([])
    expect(
      findClusters([row('a', { anchorIndex: null }), row('b', { anchorIndex: null })]),
    ).toEqual([])
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

  it('makes every pair of a cluster meet the criteria, so a chain stops where it drifts', () => {
    // a~b and b~c, but a and c sit 0.8 rad apart (cosine 0.70): c opens a cluster d joins.
    const rows = [
      row('d', { vector: at(0.85), anchorIndex: 3 }),
      row('b', { vector: at(0.4), anchorIndex: 1 }),
      row('c', { vector: at(0.8), anchorIndex: 2 }),
      row('a', { vector: at(0), anchorIndex: 0 }),
    ]

    expect(findClusters(rows)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('makes a later member meet the first member and the ones that joined after it', () => {
    // c fits a (cosine 0.83) but not b (0.36), and b joined a: c stays out.
    const rows = [
      row('a', { vector: at(0), anchorIndex: 0 }),
      row('b', { vector: at(0.6), anchorIndex: 1 }),
      row('c', { vector: at(-0.6), anchorIndex: 2 }),
    ]

    expect(findClusters(rows)).toEqual([['a', 'b']])
  })

  it('gives a row to one cluster only, the earliest it fits', () => {
    // b fits a and c alike (cosine 0.90 each); a and c don't fit (0.62): a's cluster takes b.
    const rows = [
      row('a', { vector: at(0), anchorIndex: 0 }),
      row('c', { vector: at(0.9), anchorIndex: 1 }),
      row('b', { vector: at(0.45), anchorIndex: 2 }),
    ]

    expect(findClusters(rows)).toEqual([['a', 'b']])
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
