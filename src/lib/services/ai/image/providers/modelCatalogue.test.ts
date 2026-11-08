import { describe, it, expect } from 'vitest'
import { nonEmpty } from './modelCatalogue'

describe('catalogue helpers', () => {
  it('drops an empty list', () => {
    expect(nonEmpty([])).toBeUndefined()
    expect(nonEmpty(undefined)).toBeUndefined()
    expect(nonEmpty(['a'])).toEqual(['a'])
  })
})
