import { describe, expect, it } from 'vitest'

import { excerpt } from './excerpt'

describe('excerpt', () => {
  it('returns undefined for empty or whitespace input', () => {
    expect(excerpt(null)).toBeUndefined()
    expect(excerpt('   ')).toBeUndefined()
  })

  it('collapses whitespace and keeps short text whole', () => {
    expect(excerpt('a  b\n c', 10)).toBe('a b c')
  })

  it('cuts at the last word boundary and appends an ellipsis', () => {
    expect(excerpt('The lantern gutters as you press deeper', 20)).toBe('The lantern gutters…')
  })

  it('counts code points, not UTF-16 units', () => {
    expect(excerpt('😀😀😀😀', 2)).toBe('😀😀…')
  })
})
