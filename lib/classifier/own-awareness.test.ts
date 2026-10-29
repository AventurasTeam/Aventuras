import { describe, expect, it } from 'vitest'

import { foldOwnAwareness } from './own-awareness'

const told = (happening: string, ref = 'c1') => ({
  happening,
  ref,
  source: 'told by Brannoc',
  severity: 0.8,
  learnedAtTurn: 't2',
})

const wreck = (awareness: { ref: string; source: string; severity: number }[] = []) => ({
  title: 'The wreck of the Marigold',
  awareness,
})

// classifier.md → What the classifier writes → Happenings.
describe('foldOwnAwareness', () => {
  it("moves an entry naming the reply's own happening by title into its awareness", () => {
    const out = foldOwnAwareness({
      happenings: [wreck()],
      knownAwareness: [told('  the WRECK of the Marigold '), told('hp1')],
    })
    expect(out.happenings[0].awareness).toEqual([
      { ref: 'c1', source: 'told by Brannoc', severity: 0.8, learnedAtTurn: 't2' },
    ])
    expect(out.knownAwareness).toEqual([told('hp1')])
  })

  it('keeps the happening’s own entry for a character it already lists', () => {
    const own = { ref: 'c1', source: 'witnessed it', severity: 1 }
    const out = foldOwnAwareness({
      happenings: [wreck([own])],
      knownAwareness: [told('The wreck of the Marigold')],
    })
    expect(out.happenings[0].awareness).toEqual([own])
    expect(out.knownAwareness).toEqual([])
  })

  it('leaves an invented ID, and a title no happening of the reply holds, as written', () => {
    const entries = [told('marigold_sinking'), told('The sinking of the Marigold')]
    const out = foldOwnAwareness({ happenings: [wreck()], knownAwareness: entries })
    expect(out.happenings[0].awareness).toEqual([])
    expect(out.knownAwareness).toEqual(entries)
  })

  it('keeps the own entry of a character either side writes in brackets', () => {
    const own = { ref: 'c1', source: 'witnessed it', severity: 1 }
    const bracketed = { ...own, ref: '[c1]' }
    expect(
      foldOwnAwareness({
        happenings: [wreck([own])],
        knownAwareness: [told(wreck().title, '[c1]')],
      }).happenings[0].awareness,
    ).toEqual([own])
    expect(
      foldOwnAwareness({ happenings: [wreck([bracketed])], knownAwareness: [told(wreck().title)] })
        .happenings[0].awareness,
    ).toEqual([bracketed])
  })

  it('leaves an entry naming a title two of the reply’s happenings share as written', () => {
    const entries = [told('The wreck of the Marigold')]
    const out = foldOwnAwareness({
      happenings: [wreck(), { title: 'The wreck of the marigold', awareness: [] }],
      knownAwareness: entries,
    })
    expect(out.happenings.map((h) => h.awareness)).toEqual([[], []])
    expect(out.knownAwareness).toEqual(entries)
  })
})
