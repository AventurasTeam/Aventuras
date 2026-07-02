import { describe, expect, it } from 'vitest'

import {
  ID_PATTERN,
  PLACEHOLDER_PATTERN,
  PLACEHOLDER_PREFIX_BY_KIND,
  SUBSTITUTABLE_PREFIXES,
} from './prefixes'

const UUID = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'

describe('ID_PATTERN', () => {
  it('matches every LLM-facing kind prefix', () => {
    for (const kind of SUBSTITUTABLE_PREFIXES) {
      expect(ID_PATTERN.test(`${kind}_${UUID}`)).toBe(true)
    }
  })

  it('does not match non-LLM-facing prefixes', () => {
    for (const kind of ['entry', 'act', 'run', 'story', 'br']) {
      expect(ID_PATTERN.test(`${kind}_${UUID}`)).toBe(false)
    }
  })

  it('does not match a bare uuid or a prefix without a uuid', () => {
    expect(ID_PATTERN.test(UUID)).toBe(false)
    expect(ID_PATTERN.test('char_not-a-uuid')).toBe(false)
  })
})

describe('PLACEHOLDER_PATTERN', () => {
  it('matches single- and multi-char kind placeholders', () => {
    for (const p of ['c1', 'l2', 'i3', 'f4', 'lo1', 'th2', 'hp3', 'ck4']) {
      expect(PLACEHOLDER_PATTERN.test(p)).toBe(true)
    }
  })

  it('rejects a prefix without a counter and plain words', () => {
    expect(PLACEHOLDER_PATTERN.test('c')).toBe(false)
    expect(PLACEHOLDER_PATTERN.test('hello')).toBe(false)
    expect(PLACEHOLDER_PATTERN.test('char_1')).toBe(false)
  })

  it('covers exactly the values of the kind→prefix map', () => {
    expect(new Set(Object.values(PLACEHOLDER_PREFIX_BY_KIND))).toEqual(
      new Set(['c', 'l', 'i', 'f', 'lo', 'th', 'hp', 'ck']),
    )
  })
})
