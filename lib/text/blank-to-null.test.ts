import { describe, expect, it } from 'vitest'

import { blankToNull } from './blank-to-null'

describe('blankToNull', () => {
  it('maps empty and whitespace-only text to null', () => {
    expect(blankToNull('')).toBeNull()
    expect(blankToNull(' \n\t ')).toBeNull()
  })

  it('trims surrounding whitespace from non-blank text', () => {
    expect(blankToNull('  Cosmology \n')).toBe('Cosmology')
  })
})
