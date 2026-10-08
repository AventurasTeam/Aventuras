import { describe, expect, it } from 'vitest'
import type { Entry, VaultLorebookEntry } from '$lib/types'
import {
  uniqueInjectionTerms,
  withUniqueEntryTerms,
  withUniqueVaultEntryTerms,
} from './lorebookTerms'

describe('uniqueInjectionTerms', () => {
  it('dedupes the keywords and keeps the rest of the injection', () => {
    expect(
      uniqueInjectionTerms({ mode: 'always', keywords: ['Ward', 'ward ', 'Gate'], priority: 7 }),
    ).toEqual({ mode: 'always', keywords: ['Ward', 'Gate'], priority: 7 })
  })
})

describe('withUniqueEntryTerms', () => {
  it('dedupes the aliases and the injection keywords of a whole entry', () => {
    const entry = {
      aliases: ['Keep', 'keep'],
      injection: { mode: 'keyword', keywords: ['a', 'A'], priority: 1 },
    } as Pick<Entry, 'aliases' | 'injection'>

    expect(withUniqueEntryTerms(entry)).toEqual({
      aliases: ['Keep'],
      injection: { mode: 'keyword', keywords: ['a'], priority: 1 },
    })
  })

  it('leaves out of an update what the update leaves out', () => {
    expect(withUniqueEntryTerms({ aliases: ['x', 'X'] })).toEqual({ aliases: ['x'] })
    expect(withUniqueEntryTerms({})).toEqual({})
  })

  it('does not invent an injection for an imported entry without one', () => {
    const entry = { aliases: ['x'], injection: undefined } as unknown as Pick<
      Entry,
      'aliases' | 'injection'
    >

    expect(withUniqueEntryTerms(entry).injection).toBeUndefined()
  })
})

describe('withUniqueVaultEntryTerms', () => {
  it('dedupes both lists and keeps the rest of the entry', () => {
    const entry = {
      name: 'Keep',
      keywords: ['a', 'A'],
      aliases: ['b', ' b'],
      priority: 2,
    } as VaultLorebookEntry

    expect(withUniqueVaultEntryTerms(entry)).toEqual({
      name: 'Keep',
      keywords: ['a'],
      aliases: ['b'],
      priority: 2,
    })
  })

  it('reads an absent list as empty', () => {
    const entry = { name: 'Keep' } as VaultLorebookEntry

    expect(withUniqueVaultEntryTerms(entry)).toEqual({ name: 'Keep', keywords: [], aliases: [] })
  })
})
