import { describe, expect, it } from 'vitest'

import { deepEqual } from './deep-equal'

describe('deepEqual', () => {
  it('tells an array from an object holding the same keys', () => {
    expect(deepEqual([], {})).toBe(false)
    expect(deepEqual(['x'], { 0: 'x' })).toBe(false)
    expect(deepEqual({ a: [1, { b: [] }] }, { a: [1, { b: [] }] })).toBe(true)
  })

  it('tells apart objects holding as many keys but different ones', () => {
    expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false)
    expect(deepEqual(JSON.parse('{"__proto__":{}}'), { other: {} })).toBe(false)
    expect(deepEqual(JSON.parse('{"__proto__":{}}'), JSON.parse('{"__proto__":{}}'))).toBe(true)
  })
})
