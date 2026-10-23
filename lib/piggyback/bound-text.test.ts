import { describe, expect, it } from 'vitest'

import { entityStateSchemaForKind } from '@/lib/db'

import { boundStateText } from './bound-text'

// piggyback.md → Trailing block format: a visual value's bound and cut, which conditions share.
describe('boundStateText', () => {
  it('returns a text within the 500-character bound as it is, uncut', () => {
    expect(boundStateText('notched')).toEqual({ text: 'notched', cut: false })
    expect(boundStateText('a'.repeat(500))).toEqual({ text: 'a'.repeat(500), cut: false })
  })

  it('cuts a text one character over the bound', () => {
    expect(boundStateText('a'.repeat(501)).cut).toBe(true)
  })

  it('cuts back to the last clause boundary in the second half, dropping the mark', () => {
    expect(boundStateText(`${'a'.repeat(300)}, ${'b'.repeat(300)}`)).toEqual({
      text: 'a'.repeat(300),
      cut: true,
    })
  })

  it('keeps a sentence end it cuts at', () => {
    expect(boundStateText(`${'a'.repeat(300)}. ${'b'.repeat(300)}`)).toEqual({
      text: `${'a'.repeat(300)}.`,
      cut: true,
    })
  })

  it('falls back to the last whitespace, then mid-word, never mid-surrogate', () => {
    expect(boundStateText('word '.repeat(150).trim())).toEqual({
      text: Array.from({ length: 100 }, () => 'word').join(' '),
      cut: true,
    })
    expect(boundStateText(`${'a'.repeat(499)}😀${'b'.repeat(10)}`)).toEqual({
      text: 'a'.repeat(499),
      cut: true,
    })
  })

  // data-model.md → Soft caps + compaction discipline: a condition's Zod bound is a visual value's.
  it.each([
    ['location', { parent_location_id: null }],
    ['item', { at_location_id: null }],
  ] as const)('bounds a condition the %s state schema accepts', (kind, state) => {
    const long = 'scorched and '.repeat(80)
    const schema = entityStateSchemaForKind(kind)
    expect(schema.safeParse({ ...state, condition: long }).success).toBe(false)
    expect(schema.safeParse({ ...state, condition: boundStateText(long).text }).success).toBe(true)
  })
})
