import { describe, expect, it } from 'vitest'

import { createdCharacters, factionAfter, refsResolve, toldInThirdPerson } from './checks'
import { character, faction, happening, reply, thread } from './fixture'
import { personWords } from './person'
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

describe('personWords', () => {
  it.each(['I', 'me', 'my', 'mine', 'myself'])('finds the first person singular: %s', (word) => {
    expect(personWords(`and ${word} then`)).toEqual([word])
  })

  it.each(['we', 'us', 'our', 'ours', 'ourselves'])('finds the first person plural: %s', (word) => {
    expect(personWords(`and ${word} then`)).toEqual([word])
  })

  it.each(['you', 'your', 'yours', 'yourself', 'yourselves'])(
    'finds the second person: %s',
    (word) => {
      expect(personWords(`and ${word} then`)).toEqual([word])
    },
  )

  it('reads every word but I in any case, and I only as a capital', () => {
    expect(personWords('You, YOUR, We and Us')).toEqual(['You', 'YOUR', 'We', 'Us'])
    expect(personWords('the letter i, written small')).toEqual([])
  })

  it('lists the words as written, in order of appearance', () => {
    expect(personWords('You told me that we would go, and I went.')).toEqual([
      'You',
      'me',
      'we',
      'I',
    ])
  })

  it('counts the pronoun a contraction holds', () => {
    expect(personWords('I’m sure you’re right.')).toEqual(['I', 'you'])
  })

  it('skips quoted speech between straight double quotes', () => {
    expect(personWords('Hask said, "I will find you," and rode off.')).toEqual([])
  })

  it('skips quoted speech between curly double quotes', () => {
    expect(personWords('Hask said, “I will find you,” and rode off.')).toEqual([])
  })

  it('closes a quote on either closing mark, whichever mark opened it', () => {
    expect(personWords('Hask said, "I will find you,” and I rode off.')).toEqual(['I'])
    expect(personWords('Hask said, “I will find you," and I rode off.')).toEqual(['I'])
  })

  it('counts the words between two quotes', () => {
    expect(personWords('"Go," Sefa said, and I went. "Now," she said.')).toEqual(['I'])
  })

  it('takes no apostrophe or single quote for a quote mark', () => {
    expect(personWords('Hask’s riders saw you, and Sefa’s bolt saw them.')).toEqual(['you'])
    expect(personWords("Hask's riders saw 'me' first.")).toEqual(['me'])
    expect(personWords("He wrote 'me' on the wall.")).toEqual(['me'])
    expect(personWords('He wrote ‘me’ on the wall.')).toEqual(['me'])
  })

  it('counts the rest of the text as quoted after a quote left open', () => {
    expect(personWords('We heard him say "you will pay, and I ran.')).toEqual(['We'])
    expect(personWords('We heard him say “you will pay, and I ran.')).toEqual(['We'])
  })

  it('runs a quote left open past an opening curly mark inside it', () => {
    expect(personWords('We heard him say "you will pay, and “I ran.')).toEqual(['We'])
  })

  it('finds a whole word only, never one inside a longer word', () => {
    expect(personWords('yourselves')).toEqual(['yourselves'])
    expect(personWords('It is Iris’s turn; the museum used our mineral rights.')).toEqual(['our'])
  })
})

describe('toldInThirdPerson', () => {
  const check = toldInThirdPerson()
  const describing = (...descriptions: string[]) =>
    reply({
      happenings: descriptions.map((description, i) => ({
        title: `Happening ${i + 1}`,
        description,
        involvements: [],
        awareness: [],
        sourceTurn: 't1',
      })),
    })

  it('is an avoid check a rule asks for', () => {
    expect([check.name, check.kind, check.basis]).toEqual([
      'happening descriptions in the third person',
      'avoid',
      'rule',
    ])
  })

  it('holds on descriptions told in the third person', () => {
    expect(
      check.holds(describing('Tobin unhorses Hask at the crossing.', 'Sefa shoots the archer.')),
    ).toBe(true)
  })

  it('reads the description, not the title, and holds on a reply with no happening', () => {
    const titled = reply({
      happenings: [{ title: 'I unhorse Hask', involvements: [], awareness: [], sourceTurn: 't1' }],
    })
    expect(check.holds(titled)).toBe(true)
    expect(check.holds(reply({}))).toBe(true)
  })

  it('fails when one description has "I" outside quoted speech', () => {
    expect(check.holds(describing('Tobin rides on.', 'I unhorse Hask at the crossing.'))).toBe(
      false,
    )
  })

  it('fails on a description told in the second person', () => {
    expect(check.holds(describing('You unhorse Hask at the crossing.'))).toBe(false)
  })

  it('holds with "I" inside quoted speech', () => {
    expect(check.holds(describing('Hask swears, "I will find you," as Tobin rides off.'))).toBe(
      true,
    )
  })
})
