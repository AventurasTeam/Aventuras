import { describe, expect, it } from 'vitest'

import { conjugateThirdPersonPresent } from './conjugate'

describe('conjugateThirdPersonPresent', () => {
  it('applies the regular -s suffix', () => {
    expect(conjugateThirdPersonPresent('reach')).toBe('reaches')
  })

  it('applies -es after a sibilant ending', () => {
    expect(conjugateThirdPersonPresent('push')).toBe('pushes')
    expect(conjugateThirdPersonPresent('watch')).toBe('watches')
  })

  it('uses the irregular-verb table when present', () => {
    expect(conjugateThirdPersonPresent('go')).toBe('goes')
    expect(conjugateThirdPersonPresent('have')).toBe('has')
    expect(conjugateThirdPersonPresent('do')).toBe('does')
    expect(conjugateThirdPersonPresent('be')).toBe('is')
    expect(conjugateThirdPersonPresent('try')).toBe('tries')
  })

  it('is case-preserving on the first letter', () => {
    expect(conjugateThirdPersonPresent('Reach')).toBe('Reaches')
  })
})
