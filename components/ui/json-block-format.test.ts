import { describe, expect, it } from 'vitest'

import { formatJSON } from './json-block-format'

describe('formatJSON', () => {
  it('pretty-prints a plain object with 2-space indent', () => {
    expect(formatJSON({ a: 1, b: 'two' })).toBe('{\n  "a": 1,\n  "b": "two"\n}')
  })

  it('handles arrays', () => {
    expect(formatJSON([1, 2, 3])).toBe('[\n  1,\n  2,\n  3\n]')
  })

  it('returns "null" for null', () => {
    expect(formatJSON(null)).toBe('null')
  })

  it('returns empty string for undefined (JSON.stringify(undefined) === undefined)', () => {
    expect(formatJSON(undefined)).toBe('')
  })

  it('returns String(data) on circular-ref throw', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(formatJSON(circular)).toBe(String(circular))
  })

  it('returns quoted string for a string input', () => {
    expect(formatJSON('hello')).toBe('"hello"')
  })
})
