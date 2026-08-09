import { describe, it, expect } from 'vitest'
import { cleanAliases, cleanKeywords, describeDropped } from './entryFields'

describe('cleanAliases', () => {
  it('drops an alias that is the entry name again', () => {
    // Observed: the agent aliased "Liora" to ["Liora"].
    const { value, dropped } = cleanAliases('Liora', ['Liora', 'The Herbalist'])
    expect(value).toEqual(['The Herbalist'])
    expect(dropped).toEqual([{ term: 'Liora', reason: 'same-as-name' }])
  })

  it('folds spelling, keeping the version written first', () => {
    const { value } = cleanAliases('Pento', ['Citadel', 'citadel', 'CITADEL'])
    expect(value).toEqual(['Citadel'])
  })

  it('keeps a form that differs by an article, because it is a different trigger', () => {
    // Matching is literal and whole-word: "The Citadel" fires on that phrase, "Citadel"
    // on the bare word. Neither makes the other redundant.
    expect(cleanAliases('The Citadel', ['Citadel']).value).toEqual(['Citadel'])
  })

  it('drops the name written in a different case', () => {
    expect(cleanAliases('The Citadel', ['the citadel']).value).toEqual([])
  })

  it('keeps a genuine second name', () => {
    expect(cleanAliases('Pento', ['Lord Vael', 'Vael']).value).toEqual(['Lord Vael', 'Vael'])
  })
})

describe('cleanKeywords', () => {
  it('drops a keyword the name already matches', () => {
    const { value, dropped } = cleanKeywords('Kaelen', [], ['Kaelen', 'Forge-Master'])
    expect(value).toEqual(['Forge-Master'])
    expect(dropped).toEqual([{ term: 'Kaelen', reason: 'same-as-name' }])
  })

  it('drops a keyword an alias already matches', () => {
    const { value, dropped } = cleanKeywords('Pento', ['Lord Vael'], ['Lord Vael', 'Consort'])
    expect(value).toEqual(['Consort'])
    expect(dropped[0].reason).toBe('same-as-alias')
  })

  it('drops repeats and empties', () => {
    const { value } = cleanKeywords('Nyx', [], ['spymaster', '  ', 'Spymaster', 'Stygia'])
    expect(value).toEqual(['spymaster', 'Stygia'])
  })

  it('leaves a judgement call alone — a generic keyword is the prompt’s problem', () => {
    // "guard" is bad practice, not a decidable error: only the story says whether it was
    // meant. The code removes what is provably dead, the prompt asks for the rest.
    expect(cleanKeywords('Malakor', [], ['guard']).value).toEqual(['guard'])
  })
})

describe('describeDropped', () => {
  it('says nothing when nothing was dropped', () => {
    expect(describeDropped([], [])).toBeNull()
  })

  it('names each dropped term and why', () => {
    const note = describeDropped(
      [{ term: 'Liora', reason: 'same-as-name' }],
      [{ term: 'Kaelen', reason: 'duplicate' }],
    )
    expect(note).toContain('alias "Liora"')
    expect(note).toContain('keyword "Kaelen"')
  })
})
