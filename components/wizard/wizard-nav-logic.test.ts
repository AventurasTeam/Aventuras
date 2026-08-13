import { describe, expect, it } from 'vitest'

import { DEFAULT_CALENDAR_ID, getCalendar, type CalendarSystem } from '@/lib/calendar'
import { emptyCastDraft } from '@/lib/db'

import {
  ACTIVE_STEP_ORDER,
  canJumpToStep,
  nextActiveStep,
  prevActiveStep,
  stepForwardValid,
  type StepValidityParams,
} from './wizard-nav-logic'

const calendar = getCalendar(DEFAULT_CALENDAR_ID)!

// Every tier at its start value is, by construction, in range — a minimal valid origin.
function validOrigin(cal: CalendarSystem): Record<string, number> {
  return Object.fromEntries(cal.tiers.map((tier) => [tier.name, tier.startValue]))
}

function mkParams(o: Partial<StepValidityParams> = {}): StepValidityParams {
  return {
    mode: 'creative',
    narration: 'third',
    cast: [],
    leadEntityId: null,
    worldTimeOrigin: validOrigin(calendar),
    calendar,
    lore: [],
    ...o,
  }
}

describe('stepForwardValid', () => {
  it('step 1 has no forward gate — the lead moved to step 4', () => {
    expect(stepForwardValid(1, mkParams())).toBe(true)
    expect(stepForwardValid(1, mkParams({ mode: 'adventure', cast: [], leadEntityId: null }))).toBe(
      true,
    )
  })
  it('step 2 requires a calendar and an in-range origin', () => {
    expect(stepForwardValid(2, mkParams())).toBe(true)
    expect(stepForwardValid(2, mkParams({ calendar: null }))).toBe(false)
    expect(stepForwardValid(2, mkParams({ worldTimeOrigin: {} }))).toBe(false)
  })
  it('step 4 gates on named rows and the lead requirement', () => {
    const base = {
      mode: 'adventure' as const,
      narration: 'third' as const,
      worldTimeOrigin: {},
      calendar,
      lore: [],
    }
    const lead = { ...emptyCastDraft('character', 'char_a'), name: 'Aria' }
    expect(stepForwardValid(4, { ...base, cast: [lead], leadEntityId: 'char_a' })).toBe(true)
    expect(stepForwardValid(4, { ...base, cast: [lead], leadEntityId: null })).toBe(false)
    expect(stepForwardValid(1, { ...base, cast: [], leadEntityId: null })).toBe(true)
  })
  it('step 5 has no forward gate', () => {
    expect(stepForwardValid(5, mkParams({ worldTimeOrigin: {} }))).toBe(true)
  })
})

describe('canJumpToStep', () => {
  const leadRow = { ...emptyCastDraft('character', 'char_a'), name: 'Aria' }
  const valid = mkParams({ mode: 'adventure', cast: [leadRow], leadEntityId: 'char_a' })

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
    // land on 5 by skipping the now-invalid step 2. Cast (step 4) stays
    // satisfied so this isolates step 2 as the sole blocker.
    expect(
      canJumpToStep(
        5,
        1,
        5,
        mkParams({
          mode: 'adventure',
          cast: [leadRow],
          leadEntityId: 'char_a',
          worldTimeOrigin: {},
        }),
      ),
    ).toBe(false)
  })
})

describe('step 3 in the sequence', () => {
  const clean: StepValidityParams = {
    mode: 'creative',
    narration: 'third',
    cast: [],
    leadEntityId: null,
    worldTimeOrigin: {},
    calendar: null,
    lore: [],
  }

  it('is part of the five-step active order', () => {
    expect(ACTIVE_STEP_ORDER).toEqual([1, 2, 3, 4, 5])
  })

  it('advances past step 3 when no lore is authored', () => {
    expect(stepForwardValid(3, clean)).toBe(true)
  })

  it('blocks step 3 while a lore row has an empty body', () => {
    const dirty = {
      ...clean,
      lore: [
        {
          id: 'lore_1',
          title: 'T',
          body: '',
          category: '',
          tags: [],
          injectionMode: 'auto' as const,
          priority: 0,
        },
      ],
    }
    expect(stepForwardValid(3, dirty)).toBe(false)
  })

  it('refuses a forward pill jump to 5 while step 3 is invalid', () => {
    // Step 2 must be genuinely passable here, or `.every()` short-circuits on
    // the calendar gate and step 3's verdict is never consulted.
    const calendar = getCalendar(DEFAULT_CALENDAR_ID)
    const dirty: StepValidityParams = {
      ...clean,
      calendar: calendar ?? null,
      worldTimeOrigin: { ...(calendar?.exampleStartValue ?? {}) },
      lore: [
        {
          id: 'lore_1',
          title: '',
          body: '',
          category: '',
          tags: [],
          injectionMode: 'auto' as const,
          priority: 0,
        },
      ],
    }
    expect(stepForwardValid(2, dirty), 'step 2 must pass so step 3 is the only blocker').toBe(true)
    expect(canJumpToStep(5, 3, 5, dirty)).toBe(false)
  })
})

describe('nextActiveStep / prevActiveStep', () => {
  it('advances to the next entry in ACTIVE_STEP_ORDER', () => {
    expect(nextActiveStep(1)).toBe(2)
    expect(nextActiveStep(2)).toBe(3)
    // Cast is live: step 3 advances to 4, not straight to 5 — the failure
    // mode a hardcoded "3 -> 5" pivot would reintroduce.
    expect(nextActiveStep(3)).toBe(4)
    expect(nextActiveStep(4)).toBe(5)
  })

  it('steps back to the previous entry in ACTIVE_STEP_ORDER', () => {
    expect(prevActiveStep(5)).toBe(4)
    expect(prevActiveStep(4)).toBe(3)
    expect(prevActiveStep(3)).toBe(2)
    expect(prevActiveStep(2)).toBe(1)
  })

  it('holds at the first/last entry rather than falling off the sequence', () => {
    expect(prevActiveStep(1)).toBe(1)
    expect(nextActiveStep(5)).toBe(5)
  })
})
