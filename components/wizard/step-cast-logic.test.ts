import { describe, expect, it } from 'vitest'

import { emptyCastDraft, type WizardLocationDraft } from '@/lib/db'

import {
  activeLead,
  canSetLead,
  castPlacement,
  castRowErrors,
  castStepValid,
  invalidCastRowIds,
  parentCandidates,
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

describe('parentCandidates', () => {
  const place = (id: string, parentLocationId: string | null = null) => ({
    ...emptyCastDraft('location', id),
    name: id,
    parentLocationId,
  })

  it('offers every other location when no chain leads back', () => {
    const cast = [place('city'), place('market', 'city'), place('shop')]
    expect(parentCandidates(cast[2], cast).map((r) => r.id)).toEqual(['city', 'market'])
  })

  it('leaves out the location itself and any location whose chain leads back to it', () => {
    const cast = [place('city'), place('market', 'city'), place('stall', 'market')]
    expect(parentCandidates(cast[0], cast).map((r) => r.id)).toEqual([])
    expect(parentCandidates(cast[1], cast).map((r) => r.id)).toEqual(['city'])
  })

  it('keeps the current parent listed even when a stored loop runs through it', () => {
    const cast = [place('a', 'b'), place('b', 'a')]
    expect(parentCandidates(cast[0], cast).map((r) => r.id)).toEqual(['b'])
  })
})

describe('castPlacement', () => {
  const place = (id: string, patch: Partial<WizardLocationDraft> = {}): WizardLocationDraft => ({
    ...emptyCastDraft('location', id),
    name: id,
    ...patch,
  })

  it('sits under a parent that names another cast location', () => {
    const cast = [place('city'), place('market', { parentLocationId: 'city' })]
    expect(castPlacement(cast[1], cast)).toEqual({ kind: 'under', parentId: 'city' })
  })

  it('is top-level when no parent was picked or asked for', () => {
    expect(castPlacement(place('city'), [place('city')])).toEqual({ kind: 'top' })
  })

  it('is unplaced for an unknown, unresolved, missing, self or non-location parent', () => {
    const lead = { ...emptyCastDraft('character', 'lead'), name: 'Aria' }
    const rows = [
      place('a', { parentUnknown: true }),
      place('b', { unresolvedParentLocationName: 'Mornstone Keep' }),
      place('c', { parentLocationId: 'gone' }),
      place('d', { parentLocationId: 'd' }),
      place('e', { parentLocationId: 'lead' }),
    ]
    const cast = [...rows, lead]
    for (const row of rows) expect(castPlacement(row, cast)).toEqual({ kind: 'unplaced' })
  })

  it('treats a blank unresolved name as no ask', () => {
    expect(castPlacement(place('a', { unresolvedParentLocationName: '  ' }), [])).toEqual({
      kind: 'top',
    })
  })
})
