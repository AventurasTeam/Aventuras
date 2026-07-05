import { describe, expect, it } from 'vitest'

import { DEFAULT_CALENDAR_ID, getCalendar, type CalendarSystem } from '@/lib/calendar'

import { canJumpToStep, stepForwardValid, type StepValidityParams } from './wizard-nav-logic'

const calendar = getCalendar(DEFAULT_CALENDAR_ID)!

// Every tier at its start value is, by construction, in range — a minimal valid origin.
function validOrigin(cal: CalendarSystem): Record<string, number> {
  return Object.fromEntries(cal.tiers.map((tier) => [tier.name, tier.startValue]))
}

function mkParams(o: Partial<StepValidityParams> = {}): StepValidityParams {
  return {
    mode: 'creative',
    narration: 'third',
    leadName: '',
    worldTimeOrigin: validOrigin(calendar),
    calendar,
    ...o,
  }
}

describe('stepForwardValid', () => {
  it('step 1 needs no lead for creative+third', () => {
    expect(stepForwardValid(1, mkParams())).toBe(true)
  })
  it('step 1 requires a non-blank lead name when the mode needs a lead', () => {
    expect(stepForwardValid(1, mkParams({ mode: 'adventure', leadName: '  ' }))).toBe(false)
    expect(stepForwardValid(1, mkParams({ mode: 'adventure', leadName: 'Aria' }))).toBe(true)
  })
  it('step 2 requires a calendar and an in-range origin', () => {
    expect(stepForwardValid(2, mkParams())).toBe(true)
    expect(stepForwardValid(2, mkParams({ calendar: null }))).toBe(false)
    expect(stepForwardValid(2, mkParams({ worldTimeOrigin: {} }))).toBe(false)
  })
  it('step 5 has no forward gate', () => {
    expect(stepForwardValid(5, mkParams({ worldTimeOrigin: {} }))).toBe(true)
  })
})

describe('canJumpToStep', () => {
  const valid = mkParams({ mode: 'adventure', leadName: 'Aria' })

  it('never jumps to the active step', () => {
    expect(canJumpToStep(2, 2, 5, valid)).toBe(false)
  })
  it('always allows backward jumps regardless of validity', () => {
    expect(canJumpToStep(1, 5, 5, mkParams({ worldTimeOrigin: {} }))).toBe(true)
    expect(canJumpToStep(2, 5, 5, mkParams({ worldTimeOrigin: {} }))).toBe(true)
  })
  it('blocks forward jumps to steps never visited', () => {
    expect(canJumpToStep(5, 1, 2, valid)).toBe(false)
  })
  it('allows a forward jump to a visited step when the path is valid', () => {
    expect(canJumpToStep(5, 1, 5, valid)).toBe(true)
  })
  it('blocks a forward jump when a gating step before the target is now invalid', () => {
    // Visited step 5, but the calendar origin has since been cleared → can't
    // land on 5 by skipping the now-invalid step 2.
    expect(
      canJumpToStep(
        5,
        1,
        5,
        mkParams({ mode: 'adventure', leadName: 'Aria', worldTimeOrigin: {} }),
      ),
    ).toBe(false)
  })
})
