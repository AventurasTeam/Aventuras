import { describe, expect, it } from 'vitest'

import { factionAfter } from './checks'
import { reply } from './fixture'
import { defection } from './windows/defection'

const BRANN = 'char_brann'

describe('factionAfter', () => {
  it('is undefined when the reply sets no faction for the character', () => {
    expect(
      factionAfter(
        reply({ memberships: [{ character: 'char_maela', faction: 'f', sourceTurn: 't1' }] }),
        BRANN,
      ),
    ).toBeUndefined()
  })

  it('takes the later turn over the later entry', () => {
    const r = reply({
      memberships: [
        { character: BRANN, faction: 'fact_varro', sourceTurn: 't4' },
        { character: BRANN, faction: null, sourceTurn: 't2' },
      ],
    })
    expect(factionAfter(r, BRANN)).toBe('fact_varro')
  })

  it('takes the later entry within one turn', () => {
    const r = reply({
      memberships: [
        { character: BRANN, faction: 'fact_varro', sourceTurn: 't2' },
        { character: BRANN, faction: null, sourceTurn: 't2' },
      ],
    })
    expect(factionAfter(r, BRANN)).toBeNull()
  })

  it('puts an unknown turn after every turn', () => {
    const r = reply({
      memberships: [
        { character: BRANN, faction: null, sourceTurn: 'later' },
        { character: BRANN, faction: 'fact_varro', sourceTurn: 't4' },
      ],
    })
    expect(factionAfter(r, BRANN)).toBeNull()
  })
})

// A real reply wrote a change of sides as a join and then a leave, both at t2: the planner applies
// the leave last and Brann ends in no faction.
it('the defection window fails a join followed by a leave at the same turn', () => {
  const joinThenLeave = reply({
    ...defection.ideal,
    memberships: [
      ...defection.ideal.memberships,
      { character: BRANN, faction: null, sourceTurn: 't2' },
    ],
  })
  expect(defection.checks.filter((c) => !c.holds(joinThenLeave))).toHaveLength(1)
})
