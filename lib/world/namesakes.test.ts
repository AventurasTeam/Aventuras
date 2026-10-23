import { describe, expect, it } from 'vitest'

import { nameBasis, namesakeBasis, type NamesakeSide } from './namesakes'

const side = (name: string, keywords: readonly string[] = []): NamesakeSide => ({ name, keywords })

describe('nameBasis', () => {
  it.each([
    ['Kael', 'Kael'],
    ['Kael', 'KAEL'],
    [' Kael ', 'Kael'],
    ['Zoe\u0308', 'Zo\u00eb'],
    ['Kael  Stormborn', 'Kael Stormborn'],
    ['王小明', '王小明'],
  ])('reads %j and %j as the same name', (first, second) => {
    expect(nameBasis(first, second)).toBe('same-name')
  })

  it.each([
    ['Kael', 'Kael Stormborn'],
    ['Kael Stormborn', 'Kael'],
    ['Innkeeper', 'the Innkeeper'],
    ['stormborn the', 'Kael Stormborn the Bold'],
    [' KAEL ', 'Kael Stormborn'],
    ['太郎', '山田\u3000太郎'],
  ])('reads %j and %j as one name inside the other', (first, second) => {
    expect(nameBasis(first, second)).toBe('contained')
  })

  it.each([
    ['John', 'Johnson'],
    ['Kael Bold', 'Kael the Bold'],
    ['小明', '王小明'],
    ['Kael', 'Mira'],
    ['', 'Kael'],
    ['Kael', '   '],
    ['', ''],
  ])('reads %j and %j as no match', (first, second) => {
    expect(nameBasis(first, second)).toBeNull()
  })
})

describe('namesakeBasis', () => {
  it('answers from the names first, even when a keyword also holds the other name', () => {
    expect(namesakeBasis(side('Kael'), side('Kael'))).toStrictEqual({ basis: 'same-name' })
    expect(namesakeBasis(side('Kael', ['Kael Stormborn']), side('Kael Stormborn'))).toStrictEqual({
      basis: 'contained',
    })
  })

  it('finds the other row’s name among the first row’s keywords', () => {
    expect(namesakeBasis(side('Marta', ['the innkeeper']), side('the Innkeeper'))).toStrictEqual({
      basis: 'keyword',
      holder: 'first',
      keyword: 'the innkeeper',
    })
  })

  it('finds the first row’s name among the second row’s keywords', () => {
    expect(namesakeBasis(side('the Innkeeper'), side('Marta', ['the innkeeper']))).toStrictEqual({
      basis: 'keyword',
      holder: 'second',
      keyword: 'the innkeeper',
    })
  })

  it('compares a keyword under the name rule and returns it trimmed, as stored', () => {
    expect(
      namesakeBasis(side('Marta', ['  The  INNKEEPER ']), side('the Innkeeper')),
    ).toStrictEqual({ basis: 'keyword', holder: 'first', keyword: 'The  INNKEEPER' })
  })

  it('needs the keyword to be the whole name, not part of it', () => {
    expect(namesakeBasis(side('Marta', ['innkeeper']), side('the Innkeeper'))).toBeNull()
    expect(
      namesakeBasis(side('Marta', ['the innkeeper of the docks']), side('the Innkeeper')),
    ).toBeNull()
  })

  it('prefers the first row as holder when each holds the other’s name', () => {
    expect(
      namesakeBasis(side('Marta', ['the innkeeper']), side('the Innkeeper', ['Marta'])),
    ).toStrictEqual({ basis: 'keyword', holder: 'first', keyword: 'the innkeeper' })
  })

  it('matches a name in a script without spaces only exactly or by keyword', () => {
    expect(namesakeBasis(side('小明'), side('王小明'))).toBeNull()
    expect(namesakeBasis(side('小明', ['王小明']), side('王小明'))).toStrictEqual({
      basis: 'keyword',
      holder: 'first',
      keyword: '王小明',
    })
  })

  it('never matches through a blank keyword or a blank name', () => {
    expect(namesakeBasis(side('Marta', ['', '   ']), side('   '))).toBeNull()
    expect(namesakeBasis(side('Marta'), side('Kael', ['', ' ']))).toBeNull()
  })

  it('returns null for rows that share nothing', () => {
    expect(namesakeBasis(side('Marta', ['the cook']), side('Kael', ['the courier']))).toBeNull()
  })
})
