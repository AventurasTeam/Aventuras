import { describe, expect, it } from 'vitest'

import { isDraftEmpty, planSubmissionHandback } from './composer-draft'

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

describe('planSubmissionHandback', () => {
  const EMPTY = { text: '' }
  const TYPED = { text: 'I parry and step back' }

  it('owes nothing when the destroyed entry carried no submission', () => {
    expect(planSubmissionHandback(undefined, EMPTY)).toEqual({ action: 'none' })
  })

  // The send gate blocks whitespace, and restoring it would announce an empty recovery.
  it.each(['', '   ', '\n'])('owes nothing for a %j submission', (content) => {
    expect(planSubmissionHandback({ content }, EMPTY)).toEqual({ action: 'none' })
  })

  it('restores into an empty draft', () => {
    expect(planSubmissionHandback({ content: 'I draw the blade' }, EMPTY)).toEqual({
      action: 'restore',
      content: 'I draw the blade',
    })
  })

  it('restores into an absent composer', () => {
    expect(planSubmissionHandback({ content: 'I draw the blade' }, undefined)).toEqual({
      action: 'restore',
      content: 'I draw the blade',
    })
  })

  it('restores verbatim rather than trimming — the stored text is already wrapped', () => {
    expect(planSubmissionHandback({ content: '  I draw the blade\n' }, EMPTY)).toEqual({
      action: 'restore',
      content: '  I draw the blade\n',
    })
  })

  it('keeps a typed draft instead of overwriting it', () => {
    expect(planSubmissionHandback({ content: 'I draw the blade' }, TYPED)).toEqual({
      action: 'keep-draft',
    })
  })

  // A stray space must not cost the user the only copy of their turn.
  it('treats a whitespace-only draft as room to restore into', () => {
    expect(planSubmissionHandback({ content: 'I draw the blade' }, { text: '  \n' })).toEqual({
      action: 'restore',
      content: 'I draw the blade',
    })
  })
})
