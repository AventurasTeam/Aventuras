import { describe, expect, it } from 'vitest'

import { singleParam } from './route-param'

describe('singleParam', () => {
  it('passes one value through', () => {
    expect(singleParam('br_1')).toBe('br_1')
  })

  it.each([
    ['a repeated param', ['br_1', 'br_2']],
    ['an empty one', ''],
    ['a missing one', undefined],
  ])('reads %s as nothing', (_case, value) => {
    expect(singleParam(value)).toBeUndefined()
  })
})
