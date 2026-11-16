import { describe, expect, it } from 'vitest'

import { rowAtOffset } from './row-at-offset'

// Rows of uneven heights, top to bottom: [0,100) [100,130) [130,400) [400,410) [410,900).
const BOTTOMS = [100, 130, 400, 410, 900]
const bottomOf = (index: number) => BOTTOMS[index]

describe('rowAtOffset', () => {
  it('finds the row an offset falls inside', () => {
    expect(rowAtOffset(BOTTOMS.length, bottomOf, 0)).toBe(0)
    expect(rowAtOffset(BOTTOMS.length, bottomOf, 99)).toBe(0)
    expect(rowAtOffset(BOTTOMS.length, bottomOf, 250)).toBe(2)
    expect(rowAtOffset(BOTTOMS.length, bottomOf, 405)).toBe(3)
  })

  it('takes the next row when the offset sits on a bottom edge', () => {
    expect(rowAtOffset(BOTTOMS.length, bottomOf, 100)).toBe(1)
    expect(rowAtOffset(BOTTOMS.length, bottomOf, 410)).toBe(4)
  })

  it('takes the first row for an offset above every row', () => {
    expect(rowAtOffset(BOTTOMS.length, bottomOf, -500)).toBe(0)
  })

  it('takes the last row when every row ends above the offset', () => {
    expect(rowAtOffset(BOTTOMS.length, bottomOf, 900)).toBe(4)
    expect(rowAtOffset(BOTTOMS.length, bottomOf, 5_000)).toBe(4)
  })

  it('has no row with no rows', () => {
    expect(rowAtOffset(0, bottomOf, 0)).toBeNull()
  })

  it('reads only a logarithmic number of rows', () => {
    const reads: number[] = []
    const count = 64
    rowAtOffset(count, (index) => (reads.push(index), (index + 1) * 10), 333)
    expect(reads.length).toBeLessThanOrEqual(Math.ceil(Math.log2(count)) + 1)
  })
})
