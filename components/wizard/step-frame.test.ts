import { describe, expect, it } from 'vitest'

import { needsLead } from './step-frame-logic'

describe('needsLead', () => {
  it('adventure + third → true (mode alone triggers it)', () => {
    expect(needsLead('adventure', 'third')).toBe(true)
  })

  it('adventure + first → true', () => {
    expect(needsLead('adventure', 'first')).toBe(true)
  })

  it('adventure + second → true', () => {
    expect(needsLead('adventure', 'second')).toBe(true)
  })

  it('creative + first → true (narration alone triggers it)', () => {
    expect(needsLead('creative', 'first')).toBe(true)
  })

  it('creative + second → true', () => {
    expect(needsLead('creative', 'second')).toBe(true)
  })

  it('creative + third → false (the permissive default combination)', () => {
    expect(needsLead('creative', 'third')).toBe(false)
  })
})
