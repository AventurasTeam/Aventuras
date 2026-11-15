import { describe, expect, it } from 'vitest'

import { termChanges, undoTermChange } from './term-list'

describe('termChanges', () => {
  it('reports each added, removed and respelled term by its match key', () => {
    const changes = termChanges(
      ['The Knight', 'spyglass', 'old'],
      ['the  knight', 'Spyglass', 'new'],
      'normalized',
    )

    expect(Object.fromEntries(changes)).toEqual({
      'the knight': 'respelled',
      spyglass: 'respelled',
      old: 'removed',
      new: 'added',
    })
  })

  it('matches exactly when the list is exact, so a spelling change is a remove and an add', () => {
    expect(Object.fromEntries(termChanges(['Brave'], ['brave'], 'exact'))).toEqual({
      Brave: 'removed',
      brave: 'added',
    })
  })

  it('reads a duplicate as one term, spelled as its first occurrence', () => {
    expect(termChanges(['gold', 'Gold'], ['gold'], 'normalized').size).toBe(0)
    expect(Object.fromEntries(termChanges(['Gold', 'gold'], ['gold'], 'normalized'))).toEqual({
      gold: 'respelled',
    })
  })

  it('reports nothing for a list that only moved a term', () => {
    expect(termChanges(['a', 'b'], ['b', 'a'], 'exact').size).toBe(0)
  })
})

describe('undoTermChange', () => {
  const putBack = (prior: string[], now: string[], ...terms: string[]) =>
    terms.reduce((list, term) => undoTermChange(list, term, 'removed', prior, 'exact'), now)

  // After the nearest earlier prior term present now, else at the start.
  it.each([
    [['a', 't', 'b'], ['a', 'b', 'x'], ['t'], ['a', 't', 'b', 'x']],
    [['t', 'b'], ['b', 'x'], ['t'], ['t', 'b', 'x']],
    [['t'], ['x'], ['t'], ['t', 'x']],
    [
      ['a', 't1', 't2', 'b'],
      ['a', 'b'],
      ['t1', 't2'],
      ['a', 't1', 't2', 'b'],
    ],
    [['t', 'b'], ['x', 'b'], ['t'], ['t', 'x', 'b']],
  ])('puts a removed term back at its place: prior %j, now %j', (prior, now, terms, expected) => {
    expect(putBack(prior, now, ...terms)).toEqual(expected)
  })

  it("puts a term back in the prior list's spelling", () => {
    expect(
      undoTermChange(['a'], 'the knight', 'removed', ['The Knight', 'a'], 'normalized'),
    ).toEqual(['The Knight', 'a'])
  })

  it('removes every occurrence of a term the write added', () => {
    expect(undoTermChange(['a', 'Gold', 'b', 'gold'], 'gold', 'added', [], 'normalized')).toEqual([
      'a',
      'b',
    ])
  })

  it("restores the prior list's spelling of a respelled term in place", () => {
    expect(
      undoTermChange(['a', 'Spyglass', 'b'], 'spyglass', 'respelled', ['spyglass'], 'normalized'),
    ).toEqual(['a', 'spyglass', 'b'])
  })

  // A chain whole-value undos broke can ask for any of these.
  it('changes nothing a broken chain asks of it', () => {
    expect(undoTermChange(['a'], 'gone', 'added', [], 'exact')).toEqual(['a'])
    expect(undoTermChange(['a', 't'], 't', 'removed', ['t', 'a'], 'exact')).toEqual(['a', 't'])
    expect(undoTermChange(['a'], 'gone', 'respelled', ['Gone'], 'normalized')).toEqual(['a'])
    expect(undoTermChange(['a'], 'x', 'removed', ['a'], 'exact')).toEqual(['a'])
  })
})
