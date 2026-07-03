import { describe, expect, it } from 'vitest'

import { FIXTURE_ERA_CALENDAR } from './builtins/fixtures'
import { resolveEra } from './era'

const ORIGIN = { year: 1, day: 1 }
const FLIPS = [
  { at_worldtime: 0, era_name: 'First Age' },
  { at_worldtime: 360 * 86_400, era_name: 'Second Age' },
]

describe('resolveEra', () => {
  it('returns defaultStartName at worldTime 0 when a flip sits at 0', () => {
    expect(resolveEra(0, FIXTURE_ERA_CALENDAR, ORIGIN, FLIPS)).toMatchObject({
      era: 'First Age',
      eraYear: 1,
    })
  })
  it('picks the largest flip <= worldTime', () => {
    expect(resolveEra(360 * 86_400, FIXTURE_ERA_CALENDAR, ORIGIN, FLIPS).era).toBe('Second Age')
  })
  it('computes eraYear as current year - era-start year + 1', () => {
    const r = resolveEra(720 * 86_400, FIXTURE_ERA_CALENDAR, ORIGIN, FLIPS)
    expect(r.eraYear).toBe(2)
  })
  it('falls back to defaultStartName when no flips', () => {
    expect(resolveEra(0, FIXTURE_ERA_CALENDAR, ORIGIN, []).era).toBe('First Age')
  })
})
