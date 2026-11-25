import { describe, expect, it } from 'vitest'
import { compareVectors, mergeVectors, resolveVector, vectorAfterApplying } from './vectors'

describe('compareVectors', () => {
  it('reads equal vectors as in sync, treating a missing device as zero', () => {
    expect(compareVectors({ a: 3 }, { a: 3 })).toBe('inSync')
    expect(compareVectors({ a: 3, b: 0 }, { a: 3 })).toBe('inSync')
  })

  it('tells which side moved on', () => {
    expect(compareVectors({ a: 3, b: 2 }, { a: 3 })).toBe('newerHere')
    expect(compareVectors({ a: 3 }, { a: 5 })).toBe('newerThere')
  })

  it('reads both moving on as a conflict', () => {
    expect(compareVectors({ a: 4 }, { a: 3, b: 2 })).toBe('changedOnBoth')
  })

  it('needs no shared history between two devices', () => {
    const fromA = { a: 3 }
    const editedOnB = { ...fromA, b: 1 }
    expect(compareVectors(fromA, editedOnB)).toBe('newerThere')
  })
})

describe('resolveVector', () => {
  it('outranks both inputs', () => {
    const mine = { a: 4 }
    const theirs = { a: 3, b: 2 }
    const resolved = resolveVector(mine, theirs, 'a')
    expect(resolved).toEqual({ a: 5, b: 2 })
    expect(compareVectors(resolved, mine)).toBe('newerHere')
    expect(compareVectors(resolved, theirs)).toBe('newerHere')
  })

  it('makes a discarded version on a third device read as older', () => {
    const discarded = { a: 3, c: 1 }
    const kept = { a: 3, b: 1 }
    const resolved = resolveVector(kept, discarded, 'b')
    expect(compareVectors(discarded, resolved)).toBe('newerThere')
  })
})

describe('mergeVectors', () => {
  it('takes the larger counter per device', () => {
    expect(mergeVectors({ a: 1, b: 5 }, { a: 2, c: 1 })).toEqual({ a: 2, b: 5, c: 1 })
  })
})

describe('vectorAfterApplying', () => {
  it('adopts the incoming vector when it covers the local one', () => {
    expect(vectorAfterApplying({ a: 1 }, { a: 2 }, 'b')).toEqual({ a: 2 })
    expect(vectorAfterApplying(null, { a: 2 }, 'b')).toEqual({ a: 2 })
  })

  it('resolves when the local version holds edits the incoming one lacks', () => {
    expect(vectorAfterApplying({ a: 2, b: 1 }, { a: 3 }, 'b')).toEqual({ a: 3, b: 2 })
    expect(vectorAfterApplying({ a: 5 }, { a: 3 }, 'b')).toEqual({ a: 5, b: 1 })
  })
})
