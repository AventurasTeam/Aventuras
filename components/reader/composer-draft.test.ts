import { describe, expect, it } from 'vitest'

import { isDraftEmpty } from './composer-draft'

describe('isDraftEmpty', () => {
  it('treats an absent composer as empty', () => {
    expect(isDraftEmpty(undefined)).toBe(true)
  })

  it('treats an untouched draft as empty', () => {
    expect(isDraftEmpty({ text: '' })).toBe(true)
  })

  // The gate this predicate guards overwrites the draft, so whitespace-only
  // must read as empty or a stray space would suppress the restore.
  it.each(['   ', '\n', '\t', ' \n\t '])('treats whitespace-only %j as empty', (text) => {
    expect(isDraftEmpty({ text })).toBe(true)
  })

  it('treats typed text as non-empty', () => {
    expect(isDraftEmpty({ text: 'I draw the blade' })).toBe(false)
  })

  it('treats padded text as non-empty', () => {
    expect(isDraftEmpty({ text: '  I draw the blade  ' })).toBe(false)
  })
})
