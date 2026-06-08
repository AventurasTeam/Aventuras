import { describe, expect, it } from 'vitest'

import { translationWriteSchema } from './translations-schema'

const VALID = {
  targetKind: 'entity' as const,
  targetId: 'char_1',
  field: 'description',
  language: 'es',
  translatedText: 'Hola mundo',
}

describe('translationWriteSchema', () => {
  it('parses a full translation write shape', () => {
    expect(translationWriteSchema.safeParse(VALID).success).toBe(true)
  })

  it('rejects an empty translatedText (failed translations write no row)', () => {
    expect(translationWriteSchema.safeParse({ ...VALID, translatedText: '' }).success).toBe(false)
  })

  it('rejects an unknown targetKind', () => {
    expect(translationWriteSchema.safeParse({ ...VALID, targetKind: 'bogus' }).success).toBe(false)
  })
})
