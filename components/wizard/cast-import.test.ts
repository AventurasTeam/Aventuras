import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { emptyCastDraft, entityStateSchemaForKind } from '@/lib/db'

import { ARRAY_MAX, FIELD_MAX, resolveCastImports, VOICE_MAX } from './cast-import'

let n = 0
/** Test seam — production mints real prefixed ids. */
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
          visual: { hair: 'black', attire: 'leather apron' },
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
    expect(aria).toMatchObject({
      kind: 'character',
      description: 'A blacksmith.',
      factionId: pact.id,
      traits: ['stubborn'],
    })
    expect(aria.kind === 'character' && aria.visual.hair).toBe('black')
    expect(aria.kind === 'character' && aria.visual.attire).toBe('leather apron')
  })

  it('resolves against the existing authored cast', () => {
    // Untrimmed on purpose: castDraftShared.name carries no .trim(), so an
    // authored row with padding whitespace is realistic, not a fixture typo.
    const existing = [{ ...emptyCastDraft('location', 'loc_home'), name: '  Mornstone Keep  ' }]
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

  // Scope constraint: see resolveCastImports' docblock in cast-import.ts.
  // Proven here by the same reference resolving once its batch-mate is
  // actually part of the call.
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

  // Shadowing semantics documented on the indexing loop in cast-import.ts —
  // endorsed behavior, not a bug.
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

  it('resolves a reference to a batch-mate that appears later in the batch', () => {
    const drafts = resolveCastImports(
      [
        {
          kind: 'character',
          name: 'Aria',
          description: '',
          status: 'active',
          faction_name: 'Ashfall Pact',
        },
        { kind: 'faction', name: 'Ashfall Pact', description: '', status: 'active' },
      ],
      [],
      mintId,
    )
    const pact = drafts.find((d) => d.name === 'Ashfall Pact')!
    expect(drafts[0]).toMatchObject({ factionId: pact.id })
  })

  // A blank/whitespace-only name is what an unedited "Add faction" row
  // carries — it must never become a match target, or a blank reference on
  // another row would silently bind to it instead of resolving to null.
  it('treats a blank reference as unresolved, not a match against a nameless existing-cast row', () => {
    const existing = [emptyCastDraft('faction', 'fact_blank')] // name defaults to ''
    const [char] = resolveCastImports(
      [{ kind: 'character', name: 'Nyra', description: '', status: 'active', faction_name: '   ' }],
      existing,
      mintId,
    )
    expect(char).toMatchObject({ factionId: null })
  })

  it('treats a blank reference as unresolved, not a match against a nameless batch row', () => {
    const [, gatehouse] = resolveCastImports(
      [
        { kind: 'location', name: '', description: '', status: 'active' },
        {
          kind: 'location',
          name: 'Gatehouse',
          description: '',
          status: 'active',
          parent_location_name: '  ',
        },
      ],
      [],
      mintId,
    )
    expect(gatehouse).toMatchObject({ parentLocationId: null })
  })

  // Bounds documented on the clamp constants in cast-import.ts.
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

type JsonSchemaNode = {
  properties?: Record<string, JsonSchemaNode>
  maxLength?: number
  maxItems?: number
}

function boundAt(schema: z.ZodType, path: readonly string[]) {
  let node = z.toJSONSchema(schema) as unknown as JsonSchemaNode
  for (const key of path) node = node.properties?.[key] ?? {}
  return node.maxLength ?? node.maxItems
}

// Pins VOICE_MAX/ARRAY_MAX/FIELD_MAX to entity-state-schema.ts's actual .max()
// calls (read via zod's public toJSONSchema, not its internal `_zod.def`
// shape) so a bump there fails this test until the clamp constants catch up.
describe('clamp constants track the entity-state-schema degradation bounds', () => {
  it('character: voice, traits, drives, every visual.* sub-field', () => {
    const schema = entityStateSchemaForKind('character')
    expect(boundAt(schema, ['voice'])).toBe(VOICE_MAX)
    expect(boundAt(schema, ['traits'])).toBe(ARRAY_MAX)
    expect(boundAt(schema, ['drives'])).toBe(ARRAY_MAX)
    for (const field of ['physique', 'face', 'hair', 'eyes', 'attire', 'distinguishing']) {
      expect(boundAt(schema, ['visual', field])).toBe(FIELD_MAX)
    }
  })

  it('location / item: condition', () => {
    expect(boundAt(entityStateSchemaForKind('location'), ['condition'])).toBe(FIELD_MAX)
    expect(boundAt(entityStateSchemaForKind('item'), ['condition'])).toBe(FIELD_MAX)
  })

  it('faction: agenda, standing', () => {
    const schema = entityStateSchemaForKind('faction')
    expect(boundAt(schema, ['agenda'])).toBe(ARRAY_MAX)
    expect(boundAt(schema, ['standing'])).toBe(FIELD_MAX)
  })
})
