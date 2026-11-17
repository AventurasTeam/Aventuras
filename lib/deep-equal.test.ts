import { describe, expect, it } from 'vitest'

import { deepEqual } from './deep-equal'

describe('deepEqual', () => {
  it('tells an array from an object holding the same keys', () => {
    expect(deepEqual([], {})).toBe(false)
    expect(deepEqual(['x'], { 0: 'x' })).toBe(false)
    expect(deepEqual({ a: [1, { b: [] }] }, { a: [1, { b: [] }] })).toBe(true)
  })
})
