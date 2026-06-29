import { describe, expect, it } from 'vitest'

import { IdBiMap } from './bimap'
import { MalformedPlaceholderError } from './errors'
import { parseAndSubstitute } from './parse'
import { substituteIds } from './substitute'

const charA = 'char_0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const charB = 'char_1a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'

describe('parseAndSubstitute', () => {
  it('reverses an allocated placeholder back to its uuid', () => {
    const m = new IdBiMap()
    const placeholder = m.allocate(charA)
    expect(parseAndSubstitute({ ref: placeholder, name: 'Alice' }, m)).toEqual({
      ref: charA,
      name: 'Alice',
    })
  })

  it('raises the recoverable error for an unknown placeholder-shaped string', () => {
    const m = new IdBiMap()
    expect(() => parseAndSubstitute({ ref: 'c9' }, m)).toThrow(MalformedPlaceholderError)
  })

  it('leaves plain text and non-placeholder strings untouched', () => {
    const m = new IdBiMap()
    expect(parseAndSubstitute({ note: 'hello', count: 2, missing: null }, m)).toEqual({
      note: 'hello',
      count: 2,
      missing: null,
    })
  })

  it('resolves a create site and a re-reference via one registered handle to one uuid', () => {
    const m = new IdBiMap()
    m.registerHandle('newHero', charB)
    const out = parseAndSubstitute(
      { created: { handle: 'newHero', name: 'Bob' }, alsoSeen: 'newHero' },
      m,
    )
    expect(out).toEqual({ created: { handle: charB, name: 'Bob' }, alsoSeen: charB })
  })

  it('carries the offending placeholder on the error', () => {
    const m = new IdBiMap()
    try {
      parseAndSubstitute('lo7', m)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(MalformedPlaceholderError)
      expect((e as MalformedPlaceholderError).placeholder).toBe('lo7')
    }
  })
})

describe('round-trip', () => {
  it('restores exactly the LLM-facing ids and touches nothing else', () => {
    const m = new IdBiMap()
    const original = {
      scene: [charA, charB],
      entryId: 'entry_9a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
      runId: 'run_8a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
      note: 'plain',
      count: 5,
      nested: { again: charA, none: null },
    }
    expect(parseAndSubstitute(substituteIds(original, m), m)).toEqual(original)
  })
})
