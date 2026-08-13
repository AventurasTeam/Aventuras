import { describe, expect, it } from 'vitest'

import { emptyCastDraft } from '@/lib/db'

import {
  activeLead,
  canSetLead,
  castRowErrors,
  castStepValid,
  invalidCastRowIds,
} from './step-cast-logic'

const char = (id: string, name = 'Aria', status: 'active' | 'staged' = 'active') => ({
  ...emptyCastDraft('character', id),
  name,
  status,
})

describe('cast validation gates', () => {
  it('flags rows with a blank name', () => {
    expect(castRowErrors(char('a', '  '))).toEqual(['name'])
    expect(castRowErrors(char('a'))).toEqual([])
    expect(invalidCastRowIds([char('a', ''), char('b')])).toEqual(['a'])
  })

  it('castStepValid requires every row named and, when required, an active lead', () => {
    expect(castStepValid(true, [char('a')], 'a')).toBe(true)
    expect(castStepValid(true, [char('a')], null)).toBe(false)
    expect(castStepValid(true, [char('a', 'Aria', 'staged')], 'a')).toBe(false)
    expect(castStepValid(false, [], null)).toBe(true) // creative + third: empty cast passes
    expect(castStepValid(false, [char('a', '')], null)).toBe(false)
  })

  it('activeLead rejects staged, missing, and non-character lead pointers', () => {
    const loc = emptyCastDraft('location', 'l')
    expect(activeLead([char('a')], 'a')?.id).toBe('a')
    expect(activeLead([char('a', 'Aria', 'staged')], 'a')).toBeNull()
    expect(activeLead([loc], 'l')).toBeNull()
    expect(activeLead([char('a')], 'ghost')).toBeNull()
  })

  it('canSetLead allows one-click reassignment: any active character but the current lead', () => {
    const a = char('a')
    const b = char('b', 'Jorin')
    expect(canSetLead(b, 'a')).toBe(true) // b is active + not lead, even though a already holds it
    expect(canSetLead(a, 'a')).toBe(false) // a already is the lead
    expect(canSetLead(char('c', 'X', 'staged'), null)).toBe(false)
    expect(canSetLead(emptyCastDraft('item', 'i'), null)).toBe(false)
  })
})
