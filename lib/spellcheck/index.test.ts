import { describe, expect, it } from 'vitest'

import { buildTextSegments } from './index'

describe('buildTextSegments', () => {
  it('returns a single plain segment when there are no spans', () => {
    expect(buildTextSegments('hello world', [])).toEqual([{ kind: 'plain', text: 'hello world' }])
  })

  it('splits plain text around a single span', () => {
    const result = buildTextSegments('I has went', [{ start: 2, end: 5 }])
    expect(result).toEqual([
      { kind: 'plain', text: 'I ' },
      { kind: 'lint', text: 'has', key: '2-5', index: 0 },
      { kind: 'plain', text: ' went' },
    ])
  })

  it('handles a span at the very start with no leading plain segment', () => {
    const result = buildTextSegments('has went', [{ start: 0, end: 3 }])
    expect(result).toEqual([
      { kind: 'lint', text: 'has', key: '0-3', index: 0 },
      { kind: 'plain', text: ' went' },
    ])
  })

  it('handles a span at the very end with no trailing plain segment', () => {
    const result = buildTextSegments('I has', [{ start: 2, end: 5 }])
    expect(result).toEqual([
      { kind: 'plain', text: 'I ' },
      { kind: 'lint', text: 'has', key: '2-5', index: 0 },
    ])
  })

  it('sorts out-of-order spans and preserves their original index', () => {
    const result = buildTextSegments('a bb ccc', [
      { start: 5, end: 8 },
      { start: 0, end: 1 },
    ])
    expect(result).toEqual([
      { kind: 'lint', text: 'a', key: '0-1', index: 1 },
      { kind: 'plain', text: ' bb ' },
      { kind: 'lint', text: 'ccc', key: '5-8', index: 0 },
    ])
  })

  it('handles adjacent spans with no plain text between them', () => {
    const result = buildTextSegments('abcd', [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
    expect(result).toEqual([
      { kind: 'lint', text: 'ab', key: '0-2', index: 0 },
      { kind: 'lint', text: 'cd', key: '2-4', index: 1 },
    ])
  })
})
