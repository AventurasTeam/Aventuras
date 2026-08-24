import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { emptyCastDraft, entityStateSchemaForKind, type WizardCharacterDraft } from '@/lib/db'

import { ARRAY_MAX, FIELD_MAX, pendingCastRef, resolveCastImports, VOICE_MAX } from './cast-import'

let n = 0
/** Test seam — production mints real prefixed ids. */
const mintId = (kind: string) => `${kind}_${++n}`

// Most cases here only care about the resolved rows; the unresolved-reference
// report has its own block at the bottom.
function importRows(...args: Parameters<typeof resolveCastImports>) {
  return resolveCastImports(...args).rows
}

describe('resolveCastImports', () => {
  it('resolves parent_location_name and faction_name within the imported batch', () => {
    const drafts = importRows(
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
    const [row] = importRows(
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
    const [row, char] = importRows(
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
    const [fac] = importRows(
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
    const withoutFaction = importRows(
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

    const withFaction = importRows(
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
    const drafts = importRows(
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

  // idByKey indexes every minted row's own kind:name before refs are resolved
  // (cast-import.ts), so a suggested location naming itself as its own parent
  // must not bind parentLocationId to its own freshly-minted id.
  it('never binds a location parent reference to itself', () => {
    const [keep] = importRows(
      [
        {
          kind: 'location',
          name: 'Mornstone Keep',
          description: 'A fortress.',
          status: 'active',
          parent_location_name: 'Mornstone Keep',
        },
      ],
      [],
      mintId,
    )
    expect(keep).toMatchObject({ parentLocationId: null })
  })

  it('never attaches factionId or parentLocationId to an item row', () => {
    const [item] = importRows(
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
    const drafts = importRows(
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
    const [char] = importRows(
      [{ kind: 'character', name: 'Nyra', description: '', status: 'active', faction_name: '   ' }],
      existing,
      mintId,
    )
    expect(char).toMatchObject({ factionId: null })
  })

  it('treats a blank reference as unresolved, not a match against a nameless batch row', () => {
    const [, gatehouse] = importRows(
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

  it('clamps character arrays to wizard soft caps and strings to degradation bounds', () => {
    const [char] = importRows(
      [
        {
          kind: 'character',
          name: 'Overloaded',
          description: '',
          status: 'active',
          speech: 'v'.repeat(2500),
          traits: Array.from({ length: 60 }, (_, i) => `trait-${i}`),
          drives: Array.from({ length: 60 }, (_, i) => `drive-${i}`),
          visual: { hair: 'h'.repeat(600) },
        },
      ],
      [],
      mintId,
    )
    expect(char.kind === 'character' && char.voice.length).toBe(2000)
    expect(char.kind === 'character' && char.traits.length).toBe(8)
    expect(char.kind === 'character' && char.drives.length).toBe(6)
    expect(char.kind === 'character' && char.visual.hair.length).toBe(500)
  })

  it('clamps faction agenda to its wizard soft cap and strings to degradation bounds', () => {
    const [fac, loc, item] = importRows(
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
    expect(fac.kind === 'faction' && fac.agenda.length).toBe(4)
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

describe('unresolved reference reporting', () => {
  it('reports a faction the user left unchecked, naming the row that lost it', () => {
    // The scope rule: resolution runs against the imported SELECTION plus the
    // existing cast, so checking the characters but not the faction they all
    // name drops three references with nothing on screen to say so.
    const { rows, unresolved } = resolveCastImports(
      [
        {
          kind: 'character',
          name: 'Kael',
          description: '.',
          status: 'active',
          faction_name: 'The Ashen Court',
        },
        {
          kind: 'character',
          name: 'Sera',
          description: '.',
          status: 'active',
          faction_name: 'The Ashen Court',
        },
      ],
      [],
      mintId,
    )
    expect(rows.every((r) => r.kind === 'character' && r.factionId === null)).toBe(true)
    expect(unresolved).toEqual([
      { rowName: 'Kael', field: 'faction', wantedName: 'The Ashen Court' },
      { rowName: 'Sera', field: 'faction', wantedName: 'The Ashen Court' },
    ])
  })

  it('stays empty when every reference resolves', () => {
    const { unresolved } = resolveCastImports(
      [
        { kind: 'faction', name: 'The Ashen Court', description: '.', status: 'active' },
        {
          kind: 'character',
          name: 'Kael',
          description: '.',
          status: 'active',
          faction_name: 'The Ashen Court',
        },
      ],
      [],
      mintId,
    )
    expect(unresolved).toEqual([])
  })

  it('does not report a reference the model simply omitted', () => {
    const { unresolved } = resolveCastImports(
      [
        { kind: 'character', name: 'Kael', description: '.', status: 'active' },
        {
          kind: 'location',
          name: 'Ashfall',
          description: '.',
          status: 'active',
          parent_location_name: '   ',
        },
      ],
      [],
      mintId,
    )
    expect(unresolved).toEqual([])
  })

  it('reports a self-referential parent, which imports without its pointer', () => {
    const { rows, unresolved } = resolveCastImports(
      [
        {
          kind: 'location',
          name: 'The Salt Wells',
          description: '.',
          status: 'active',
          parent_location_name: 'The Salt Wells',
        },
      ],
      [],
      mintId,
    )
    expect(rows[0]).toMatchObject({ kind: 'location', parentLocationId: null })
    expect(unresolved).toEqual([
      { rowName: 'The Salt Wells', field: 'parentLocation', wantedName: 'The Salt Wells' },
    ])
  })

  it('does not report a reference that resolves against the already-authored cast', () => {
    const { unresolved } = resolveCastImports(
      [
        {
          kind: 'character',
          name: 'Kael',
          description: '.',
          status: 'active',
          faction_name: 'Ashfall Pact',
        },
      ],
      [{ ...emptyCastDraft('faction', 'fact_existing'), name: 'Ashfall Pact' }],
      mintId,
    )
    expect(unresolved).toEqual([])
  })
})

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

describe('pendingCastRef', () => {
  const character = (over: Partial<WizardCharacterDraft> = {}): WizardCharacterDraft => ({
    ...emptyCastDraft('character', 'char_1'),
    ...over,
  })
  const faction = (name: string, id = 'fact_1', status: 'active' | 'staged' = 'active') => ({
    ...emptyCastDraft('faction', id),
    name,
    status,
  })

  it('reports nothing once the field is assigned, even with a remembered ask', () => {
    const row = character({ factionId: 'fact_1', unresolvedFactionName: 'Ashfall Pact' })
    expect(pendingCastRef(row, [row, faction('Ashfall Pact')])).toBeNull()
  })

  it('reports the ask as missing while no active row carries the name', () => {
    const row = character({ unresolvedFactionName: 'Ashfall Pact' })
    expect(pendingCastRef(row, [row])).toEqual({
      field: 'faction',
      wantedName: 'Ashfall Pact',
      resolvableId: null,
    })
  })

  // The whole point of re-checking at render: importing the faction afterwards
  // has to change the message without a re-import.
  it('reports the ask as resolvable once a matching active row exists', () => {
    const row = character({ unresolvedFactionName: 'ashfall pact' })
    expect(pendingCastRef(row, [row, faction('Ashfall Pact')])?.resolvableId).toBe('fact_1')
  })

  it('does not resolve against a staged row, matching what commit would accept', () => {
    const row = character({ unresolvedFactionName: 'Ashfall Pact' })
    expect(
      pendingCastRef(row, [row, faction('Ashfall Pact', 'fact_1', 'staged')])?.resolvableId,
    ).toBe(null)
  })

  it('does not resolve a faction ask against a same-named location', () => {
    const row = character({ unresolvedFactionName: 'Mornstone' })
    const loc = { ...emptyCastDraft('location', 'loc_1'), name: 'Mornstone' }
    expect(pendingCastRef(row, [row, loc])?.resolvableId).toBe(null)
  })

  it('reports a location parent ask on its own field', () => {
    const row = { ...emptyCastDraft('location', 'loc_1'), unresolvedParentLocationName: 'The Vale' }
    expect(pendingCastRef(row, [row])).toEqual({
      field: 'parentLocation',
      wantedName: 'The Vale',
      resolvableId: null,
    })
  })
})
