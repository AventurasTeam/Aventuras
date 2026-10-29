import { describe, expect, it } from 'vitest'

import { createdCharacters, factionAfter, refsResolve } from './checks'
import { character, faction, happening, reply, thread } from './fixture'
import { defection } from './windows/defection'

const BRANN = 'char_brann'

describe('createdCharacters', () => {
  it('leaves out a new character with a blank name, which the planner never creates', () => {
    const entry = (handle: string, name: string) => ({
      handle,
      name,
      description: 'x',
      keywords: [],
      sourceTurn: 't1',
    })
    const r = reply({
      newCharacters: [
        entry('new:dov', 'Dov Hask'),
        entry('new:archer', ''),
        entry('new:rider', ' '),
      ],
    })
    expect(createdCharacters(r).map((c) => c.handle)).toEqual(['new:dov'])
  })

  it('leaves out one named as the reply renames a listed character, which the planner absorbs', () => {
    const ilse = {
      handle: 'new:ilse',
      name: 'ilse  MARROW',
      description: 'x',
      keywords: [],
      sourceTurn: 't2',
    }
    const renamed = (ref: string, name: string) =>
      createdCharacters(
        reply({ newCharacters: [ilse], renames: [{ ref, name, sourceTurn: 't2' }] }),
      ).length
    expect(renamed('char_grey', 'Ilse Marrow')).toBe(0)
    expect(renamed('char_grey', 'Ilse')).toBe(1)
    expect(renamed('fact_grey', 'Ilse Marrow')).toBe(1)
  })
})

describe('factionAfter', () => {
  it('is undefined when the reply sets no faction for the character', () => {
    expect(
      factionAfter(
        reply({ memberships: [{ character: 'char_maela', faction: 'f', sourceTurn: 't1' }] }),
        BRANN,
        'fact_wardens',
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
    expect(factionAfter(r, BRANN, 'fact_wardens')).toBe('fact_varro')
  })

  it('takes the later of two joins within one turn', () => {
    const r = reply({
      memberships: [
        { character: BRANN, faction: 'fact_varro', sourceTurn: 't2' },
        { character: BRANN, faction: 'fact_wardens', sourceTurn: 't2' },
      ],
    })
    expect(factionAfter(r, BRANN, 'fact_wardens')).toBe('fact_wardens')
  })

  it('reads a none beside a join within one turn as the leave before the join', () => {
    const r = reply({
      memberships: [
        { character: BRANN, faction: 'fact_varro', sourceTurn: 't2' },
        { character: BRANN, faction: null, sourceTurn: 't2' },
      ],
    })
    expect(factionAfter(r, BRANN, 'fact_wardens')).toBe('fact_varro')
  })

  it('keeps the reply order within one turn with no faction to leave, or the held one restated', () => {
    const joinThenNone = (faction: string) =>
      reply({
        memberships: [
          { character: BRANN, faction, sourceTurn: 't2' },
          { character: BRANN, faction: null, sourceTurn: 't2' },
        ],
      })
    expect(factionAfter(joinThenNone('fact_varro'), BRANN, null)).toBeNull()
    expect(factionAfter(joinThenNone('fact_wardens'), BRANN, 'fact_wardens')).toBeNull()
  })

  it('puts an unknown turn after every turn', () => {
    const r = reply({
      memberships: [
        { character: BRANN, faction: null, sourceTurn: 'later' },
        { character: BRANN, faction: 'fact_varro', sourceTurn: 't4' },
      ],
    })
    expect(factionAfter(r, BRANN, 'fact_wardens')).toBeNull()
  })
})

// A real reply wrote a change of sides as a join and then a leave, both at t2: the planner applies
// the leave first, so Brann ends in House Varro.
it('the defection window passes a join followed by a leave at the same turn', () => {
  const joinThenLeave = reply({
    ...defection.ideal,
    memberships: [
      ...defection.ideal.memberships,
      { character: BRANN, faction: null, sourceTurn: 't2' },
    ],
  })
  expect(defection.checks.filter((c) => !c.holds(joinThenLeave)).map((c) => c.name)).toEqual([])
})

describe('refsResolve', () => {
  const check = refsResolve({
    entities: [character('char_a', 'A'), faction('fact_b', 'B')],
    happenings: [happening('hap_c', 'C')],
    threads: [thread('thr_d', 'D', 'active')],
  })
  const hap = (involvement: string, aware: string) => ({
    title: 't',
    involvements: [{ ref: involvement, role: 'actor' }],
    awareness: [{ ref: aware, source: 's', severity: 0.5 }],
    sourceTurn: 't1',
  })
  const naming = (ref: string) => ({
    'an involvement': reply({ happenings: [hap(ref, 'char_a')] }),
    'an awareness': reply({ happenings: [hap('char_a', ref)] }),
    'a relationship subject': reply({
      relationships: [{ subject: ref, object: 'char_a', kind: 'k', sourceTurn: 't1' }],
    }),
    'a relationship object': reply({
      relationships: [{ subject: 'char_a', object: ref, kind: 'k', sourceTurn: 't1' }],
    }),
    'a status flip': reply({ statusFlips: [{ ref, to: 'active', sourceTurn: 't1' }] }),
    'a membership character': reply({
      memberships: [{ character: ref, faction: 'fact_b', sourceTurn: 't1' }],
    }),
    'a membership faction': reply({
      memberships: [{ character: 'char_a', faction: ref, sourceTurn: 't1' }],
    }),
    'an alias': reply({ aliases: [{ ref, terms: ['x'], sourceTurn: 't1' }] }),
    'a rename': reply({ renames: [{ ref, name: 'x', sourceTurn: 't1' }] }),
    'a placement': reply({ placements: [{ ref, parent: 'top-level', sourceTurn: 't1' }] }),
    'a placement parent': reply({ placements: [{ ref: 'char_a', parent: ref, sourceTurn: 't1' }] }),
    'a standing': reply({ standings: [{ ref, standing: 'x', sourceTurn: 't1' }] }),
    'a thread status': reply({
      threadStatuses: [{ thread: ref, status: 'resolved', sourceTurn: 't1' }],
    }),
    'a knownAwareness character': reply({
      knownAwareness: [{ happening: 'hap_c', ref, source: 's', severity: 0.5 }],
    }),
  })

  it.each(Object.entries(naming('c9')))('fails on an invented ID in %s', (_, r) => {
    expect(check.holds(r)).toBe(false)
  })

  it.each(Object.entries(naming('char_a')))('holds on a listed ID in %s', (_, r) => {
    expect(check.holds(r)).toBe(true)
  })

  it('holds on a handle the reply declares, a null faction and a thread it lists', () => {
    const r = reply({
      newCharacters: [
        { handle: 'new:e', name: 'E', description: 'x', keywords: [], sourceTurn: 't1' },
      ],
      newFactions: [
        { handle: 'new:f', name: 'F', description: 'x', keywords: [], sourceTurn: 't1' },
      ],
      memberships: [
        { character: 'new:e', faction: 'new:f', sourceTurn: 't1' },
        { character: 'char_a', faction: null, sourceTurn: 't1' },
      ],
      threadStatuses: [{ thread: 'thr_d', status: 'resolved', sourceTurn: 't1' }],
    })
    expect(check.holds(r)).toBe(true)
  })
})
