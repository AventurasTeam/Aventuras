import { describe, expect, it } from 'vitest'

import { nullifyRef } from './coerce'

describe('nullifyRef', () => {
  it('collapses empty string and nullish to null', () => {
    expect(nullifyRef('')).toBeNull()
    expect(nullifyRef(null)).toBeNull()
    expect(nullifyRef(undefined)).toBeNull()
  })

  it('passes non-empty ids through unchanged', () => {
    expect(nullifyRef('se_5')).toBe('se_5')
    expect(nullifyRef(' ')).toBe(' ')
  })
})
