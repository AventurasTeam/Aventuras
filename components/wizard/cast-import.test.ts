import { describe, expect, it } from 'vitest'

import { emptyCastDraft } from '@/lib/db'

import { resolveCastImports } from './cast-import'

let n = 0
const mintId = (kind: string) => `${kind}_${++n}`

describe('resolveCastImports', () => {
  it('resolves parent_location_name and faction_name within the imported batch', () => {
    const drafts = resolveCastImports(
      [
        { kind: 'faction', name: 'Ashfall Pact', description: 'A cult.', status: 'active' },
        { kind: 'location', name: 'Mornstone Keep', description: 'A fortress.', status: 'active' },
        {
          kind: 'location',
          name: 'The Undercroft',
          description: 'Below the keep.',
          status: 'active',
          parent_location_name: 'mornstone keep', // case-insensitive
        },
        {
          kind: 'character',
          name: 'Aria',
          description: 'A blacksmith.',
          status: 'active',
          faction_name: 'Ashfall Pact',
          traits: ['stubborn'],
          visual: { hair: 'black' },
        },
      ],
      [],
      mintId,
    )
    const keep = drafts.find((d) => d.name === 'Mornstone Keep')!
    const under = drafts.find((d) => d.name === 'The Undercroft')!
    const pact = drafts.find((d) => d.name === 'Ashfall Pact')!
    const aria = drafts.find((d) => d.name === 'Aria')!
    expect(under).toMatchObject({ kind: 'location', parentLocationId: keep.id })
    expect(aria).toMatchObject({ kind: 'character', factionId: pact.id, traits: ['stubborn'] })
    expect(aria.kind === 'character' && aria.visual.hair).toBe('black')
  })

  it('resolves against the existing authored cast', () => {
    const existing = [{ ...emptyCastDraft('location', 'loc_home'), name: 'Mornstone Keep' }]
    const [row] = resolveCastImports(
      [
        {
          kind: 'location',
          name: 'Gatehouse',
          description: '',
          status: 'active',
          parent_location_name: 'Mornstone Keep',
        },
      ],
      existing,
      mintId,
    )
    expect(row).toMatchObject({ parentLocationId: 'loc_home' })
  })

  it('falls back to null for unresolved names and wrong-kind matches', () => {
    const existing = [{ ...emptyCastDraft('faction', 'fact_x'), name: 'Mornstone Keep' }] // faction, not location
    const [row, char] = resolveCastImports(
      [
        {
          kind: 'location',
          name: 'Gatehouse',
          description: '',
          status: 'active',
          parent_location_name: 'Mornstone Keep',
        },
        {
          kind: 'character',
          name: 'Jorin',
          description: '',
          status: 'active',
          faction_name: 'Unknown House',
        },
      ],
      existing,
      mintId,
    )
    expect(row).toMatchObject({ parentLocationId: null })
    expect(char).toMatchObject({ factionId: null })
  })

  it('carries staged status and per-kind fields into drafts', () => {
    const [fac] = resolveCastImports(
      [
        {
          kind: 'faction',
          name: 'Pact',
          description: 'A cult.',
          status: 'staged',
          agenda: ['expand'],
          standing: 'ascendant',
        },
      ],
      [],
      mintId,
    )
    expect(fac).toMatchObject({ status: 'staged', agenda: ['expand'], standing: 'ascendant' })
  })

  // Canon (wizard.md → AI-suggest): resolution scope is the imported selection
  // plus the existing cast — never the whole suggested page. resolveCastImports
  // only ever sees what's passed as `suggestions`, so a batch-mate the user left
  // unchecked (never part of that argument) must resolve null exactly like a
  // name that never existed — proven here by the same reference resolving once
  // its batch-mate is actually included.
  it('does not resolve a name whose batch-mate was left out of the imported selection', () => {
    const withoutFaction = resolveCastImports(
      [
        {
          kind: 'character',
          name: 'Kessa',
          description: '',
          status: 'active',
          faction_name: 'Unchecked Pact',
        },
      ],
      [],
      mintId,
    )
    expect(withoutFaction[0]).toMatchObject({ factionId: null })

    const withFaction = resolveCastImports(
      [
        { kind: 'faction', name: 'Unchecked Pact', description: '', status: 'active' },
        {
          kind: 'character',
          name: 'Kessa',
          description: '',
          status: 'active',
          faction_name: 'Unchecked Pact',
        },
      ],
      [],
      mintId,
    )
    const pact = withFaction.find((d) => d.name === 'Unchecked Pact')!
    const kessa = withFaction.find((d) => d.name === 'Kessa')!
    expect(kessa).toMatchObject({ factionId: pact.id })
  })

  // The minted-batch pass runs after the existing-cast pass is indexed, so a
  // same-kind/same-name batch row overwrites the existing row's map entry —
  // the freshest import wins for reference purposes within this call.
  it('lets a same-name batch row shadow an existing-cast row of the same kind', () => {
    const existing = [{ ...emptyCastDraft('location', 'loc_old'), name: 'Mornstone Keep' }]
    const drafts = resolveCastImports(
      [
        { kind: 'location', name: 'Mornstone Keep', description: 'Rebuilt.', status: 'active' },
        {
          kind: 'location',
          name: 'Gatehouse',
          description: '',
          status: 'active',
          parent_location_name: 'Mornstone Keep',
        },
      ],
      existing,
      mintId,
    )
    const newKeep = drafts.find((d) => d.name === 'Mornstone Keep')!
    const gatehouse = drafts.find((d) => d.name === 'Gatehouse')!
    expect(newKeep.id).not.toBe('loc_old')
    expect(gatehouse).toMatchObject({ parentLocationId: newKeep.id })
  })

  it('never attaches factionId or parentLocationId to an item row', () => {
    const [item] = resolveCastImports(
      [
        {
          kind: 'item',
          name: 'Ashfall Blade',
          description: '',
          status: 'active',
          condition: 'notched',
        },
      ],
      [],
      mintId,
    )
    expect(item).not.toHaveProperty('factionId')
    expect(item).not.toHaveProperty('parentLocationId')
  })

  // docs/data-model.md → Zod degradation bounds, enforced at the DB write
  // boundary by lib/db/entities/entity-state-schema.ts. Clamped at import so
  // acceptance never turns into a raw per-entity Zod rejection after the fact.
  it('clamps character voice/traits/drives/visual fields to the degradation bounds', () => {
    const [char] = resolveCastImports(
      [
        {
          kind: 'character',
          name: 'Overloaded',
          description: '',
          status: 'active',
          voice: 'v'.repeat(2500),
          traits: Array.from({ length: 60 }, (_, i) => `trait-${i}`),
          drives: Array.from({ length: 60 }, (_, i) => `drive-${i}`),
          visual: { hair: 'h'.repeat(600) },
        },
      ],
      [],
      mintId,
    )
    expect(char.kind === 'character' && char.voice.length).toBe(2000)
    expect(char.kind === 'character' && char.traits.length).toBe(50)
    expect(char.kind === 'character' && char.drives.length).toBe(50)
    expect(char.kind === 'character' && char.visual.hair.length).toBe(500)
  })

  it('clamps faction agenda/standing and location/item condition to the degradation bounds', () => {
    const [fac, loc, item] = resolveCastImports(
      [
        {
          kind: 'faction',
          name: 'Overloaded Pact',
          description: '',
          status: 'active',
          agenda: Array.from({ length: 60 }, (_, i) => `goal-${i}`),
          standing: 's'.repeat(600),
        },
        {
          kind: 'location',
          name: 'Overloaded Keep',
          description: '',
          status: 'active',
          condition: 'c'.repeat(600),
        },
        {
          kind: 'item',
          name: 'Overloaded Blade',
          description: '',
          status: 'active',
          condition: 'c'.repeat(600),
        },
      ],
      [],
      mintId,
    )
    expect(fac.kind === 'faction' && fac.agenda.length).toBe(50)
    expect(fac.kind === 'faction' && fac.standing.length).toBe(500)
    expect(loc.kind === 'location' && loc.condition.length).toBe(500)
    expect(item.kind === 'item' && item.condition.length).toBe(500)
  })
})
