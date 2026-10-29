import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { IdBiMap } from '@/lib/ids'

import { classifierExtractionWithPlacesSchema } from './schema'
import {
  idNames,
  nameIdsInProse,
  PLACEHOLDER_FIELDS,
  PROSE_FIELDS,
  substituteClassifierIds,
} from './substitute'

const CHAR_A = 'char_11111111-1111-1111-1111-111111111111'
const CHAR_B = 'char_22222222-2222-2222-2222-222222222222'
const LOC_A = 'loc_33333333-3333-3333-3333-333333333333'
const HAP_A = 'hap_44444444-4444-4444-4444-444444444444'
const THR_A = 'thr_55555555-5555-5555-5555-555555555555'

/** Every string-valued property name the wire schema declares, at any depth. */
function stringFieldsOf(schema: z.ZodType): string[] {
  const found = new Set<string>()
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const properties = record.properties as Record<string, unknown> | undefined
    if (properties) {
      for (const [name, child] of Object.entries(properties)) {
        const { type, anyOf } = child as { type?: string; anyOf?: { type?: string }[] }
        // A nullable string is `anyOf [string, null]`.
        if (type === 'string' || anyOf?.some((member) => member.type === 'string')) found.add(name)
        walk(child)
      }
      return
    }
    for (const child of Object.values(record)) walk(child)
  }
  walk(z.toJSONSchema(schema))
  return [...found].sort()
}

// Fields the model fills with something other than an entity reference: prose,
// free-form anchors, and the provenance handles the window map owns.
const NON_REF_FIELDS = [
  'attire',
  'category',
  'condition',
  'description',
  'distinguishing',
  'eyes',
  'face',
  'hair',
  'handle',
  'icon',
  'kind',
  'learnedAtTurn',
  'name',
  'physique',
  'reason',
  'resolvedAtTurn',
  'role',
  'source',
  'sourceTurn',
  'standing',
  'status',
  'temporal',
  'title',
  'to',
  'voice',
]

describe('PLACEHOLDER_FIELDS', () => {
  // A new ref-bearing schema field fails here until classified, instead of silently
  // never resolving and landing in unresolvedRefs. The places schema is the superset.
  it('partitions every string field the schema declares into ref-bearing or not', () => {
    expect(stringFieldsOf(classifierExtractionWithPlacesSchema)).toEqual(
      [...PLACEHOLDER_FIELDS, ...NON_REF_FIELDS].sort(),
    )
  })

  it('does not overlap the non-reference fields', () => {
    expect(PLACEHOLDER_FIELDS.filter((f) => NON_REF_FIELDS.includes(f))).toEqual([])
  })

  // A new prose field fails here until nameIdsInProse reads it, or it is named an id, turn or enum.
  it('leaves only handles, turns and enum values out of the prose fields', () => {
    expect(NON_REF_FIELDS.filter((f) => !(PROSE_FIELDS as readonly string[]).includes(f))).toEqual([
      'handle',
      'icon',
      'learnedAtTurn',
      'resolvedAtTurn',
      'sourceTurn',
      'status',
      'to',
    ])
  })
})

// classifier.md → ID handling in classifier output: a placeholder in prose.
describe('nameIdsInProse', () => {
  const names: Record<string, string> = { c1: 'Pell', c2: 'Tobin Ash', 'new:hask': 'Dov Hask' }
  const nameOf = (token: string) => names[token]

  it('names a bracketed or bare ID or handle in prose, wherever the prose sits', () => {
    const out = nameIdsInProse(
      {
        happenings: [
          {
            title: 'c2 at the ford',
            description: '[c1] charged [new:hask]; new:hask fell, and c2 watched.',
            involvements: [{ ref: 'c1', role: 'rescuer of [c2]' }],
            awareness: [{ ref: 'c2', source: 'told by [c1]', learnedAtTurn: 't2' }],
            sourceTurn: 't2',
          },
        ],
        newCharacters: [
          {
            handle: 'new:hask',
            name: 'Dov Hask',
            traits: ['hates [c2]'],
            visual: { attire: "c1's old coat" },
          },
        ],
      },
      nameOf,
    )
    expect(out).toEqual({
      happenings: [
        {
          title: 'Tobin Ash at the ford',
          description: 'Pell charged Dov Hask; Dov Hask fell, and Tobin Ash watched.',
          involvements: [{ ref: 'c1', role: 'rescuer of Tobin Ash' }],
          awareness: [{ ref: 'c2', source: 'told by Pell', learnedAtTurn: 't2' }],
          sourceTurn: 't2',
        },
      ],
      newCharacters: [
        {
          handle: 'new:hask',
          name: 'Dov Hask',
          traits: ['hates Tobin Ash'],
          visual: { attire: "Pell's old coat" },
        },
      ],
    })
  })

  it('leaves a token it names nothing for as written', () => {
    const prose = { description: '[c9] and c9 at [t2], in v2 of the map, by new:nobody' }
    expect(nameIdsInProse(prose, nameOf)).toEqual(prose)
  })
})

describe('idNames', () => {
  it("names a listed row's placeholder, and a handle by its first declaration", () => {
    const idMap = new IdBiMap()
    const c = idMap.allocate(CHAR_A)
    const hp = idMap.allocate(HAP_A)
    const th = idMap.allocate(THR_A)
    const nameOf = idNames(
      idMap,
      {
        entities: [{ id: CHAR_A, name: 'Kael' }],
        happenings: [{ id: HAP_A, title: 'The ford ambush' }],
        threads: [{ id: THR_A, title: 'Find the heir' }],
      },
      {
        newCharacters: [
          { handle: 'new:x', name: ' Dov ' },
          { handle: 'new:x', name: 'Later' },
          { handle: 'new:blank', name: ' ' },
        ],
        newFactions: [{ handle: 'new:guild', name: 'The Guild' }],
      },
    )
    expect([c, hp, th, 'new:x', 'new:guild', 'new:blank', 'c9'].map(nameOf)).toEqual([
      'Kael',
      'The ford ambush',
      'Find the heir',
      'Dov',
      'The Guild',
      undefined,
      undefined,
    ])
  })

  it("names a handle spelling a listed row's placeholder as the reply's, as its refs read", () => {
    const idMap = new IdBiMap()
    const c1 = idMap.allocate(CHAR_A)
    const c2 = idMap.allocate(CHAR_B)
    const nameOf = idNames(
      idMap,
      {
        entities: [
          { id: CHAR_A, name: 'Kael' },
          { id: CHAR_B, name: 'Aria' },
        ],
        happenings: [],
        threads: [],
      },
      {
        newCharacters: [
          { handle: c1, name: 'Dov' },
          { handle: c2, name: '' },
        ],
        newFactions: [],
      },
    )
    expect([c1, c2].map(nameOf)).toEqual(['Dov', undefined])
  })
})

describe('substituteClassifierIds', () => {
  it('maps placeholders back to uuids in ref-bearing fields only', () => {
    const idMap = new IdBiMap()
    const a = idMap.allocate(CHAR_A)
    const b = idMap.allocate(CHAR_B)
    const out = substituteClassifierIds(
      {
        happenings: [
          { title: a, involvements: [{ ref: a, role: b }], awareness: [{ ref: b, source: a }] },
        ],
        relationships: [{ subject: a, object: b, kind: a }],
      },
      idMap,
    )
    expect(out).toEqual({
      happenings: [
        {
          // `title` and `role` are prose: a model echoing a placeholder there
          // must not have it silently rewritten into a uuid.
          title: a,
          involvements: [{ ref: CHAR_A, role: b }],
          awareness: [{ ref: CHAR_B, source: a }],
        },
      ],
      relationships: [{ subject: CHAR_A, object: CHAR_B, kind: a }],
    })
  })

  // classifier.md → ID handling: a reply that copies the prompt's brackets lost every fact naming them.
  it('reads a placeholder or a handle written in its brackets as the bare one', () => {
    const idMap = new IdBiMap()
    const kael = idMap.allocate(CHAR_A)
    const fire = idMap.allocate(HAP_A)
    const out = substituteClassifierIds(
      {
        newCharacters: [{ handle: 'new:guard' }],
        relationships: [{ subject: `[${kael}]`, object: '[new:guard]' }],
        knownAwareness: [{ happening: `[${fire}]`, ref: '[c9]', source: `[${kael}]` }],
      },
      idMap,
      new Set(['new:guard']),
    )
    expect(out).toEqual({
      newCharacters: [{ handle: 'new:guard' }],
      relationships: [{ subject: CHAR_A, object: 'new:guard' }],
      // An unknown ID keeps its brackets for the planner to report as written; prose keeps them.
      knownAwareness: [{ happening: HAP_A, ref: '[c9]', source: `[${kael}]` }],
    })
  })

  it('leaves an unknown ref untouched so the planner can resolve or report it', () => {
    const idMap = new IdBiMap()
    // 'nc1' is a newCharacters temp handle; 'c9' was never allocated.
    const out = substituteClassifierIds({ ref: 'nc1', subject: 'c9' }, idMap)
    expect(out).toEqual({ ref: 'nc1', subject: 'c9' })
  })

  // Without the reserved set, a model that names a new character 'c1' has every
  // ref to it rewritten into the existing entity c1 — the fact lands on the wrong
  // character with no unresolved ref and no warning anywhere.
  it('never rewrites a ref that a newCharacters handle claims, even on a placeholder collision', () => {
    const idMap = new IdBiMap()
    const collide = idMap.allocate(CHAR_A)
    const out = substituteClassifierIds(
      { newCharacters: [{ handle: collide }], relationships: [{ subject: collide, object: 'c9' }] },
      idMap,
      new Set([collide]),
    )
    expect(out).toEqual({
      newCharacters: [{ handle: collide }],
      relationships: [{ subject: collide, object: 'c9' }],
    })
  })

  it("maps a new place's parent placeholder back, and leaves another new place's handle", () => {
    const idMap = new IdBiMap()
    const town = idMap.allocate(LOC_A)
    const out = substituteClassifierIds(
      {
        newPlaces: [
          { handle: 'new:inn', parent: town },
          { handle: 'new:cellar', parent: 'new:inn' },
        ],
      },
      idMap,
      new Set(['new:inn', 'new:cellar']),
    )
    expect(out).toEqual({
      newPlaces: [
        { handle: 'new:inn', parent: LOC_A },
        { handle: 'new:cellar', parent: 'new:inn' },
      ],
    })
  })

  // classifier.md → ID handling: a listed happening and a listed thread go back to their ids.
  it("maps a listed happening's and thread's placeholders back, and leaves the top-level token", () => {
    const idMap = new IdBiMap()
    const kael = idMap.allocate(CHAR_A)
    const fire = idMap.allocate(HAP_A)
    const relic = idMap.allocate(THR_A)
    const town = idMap.allocate(LOC_A)
    const out = substituteClassifierIds(
      {
        knownAwareness: [{ happening: fire, ref: kael, source: fire }],
        threadStatuses: [{ thread: relic, status: 'resolved' }],
        placements: [
          { ref: town, parent: 'top-level' },
          { ref: town, parent: town },
        ],
        renames: [{ ref: kael, name: kael }],
      },
      idMap,
    )
    expect(out).toEqual({
      knownAwareness: [{ happening: HAP_A, ref: CHAR_A, source: fire }],
      threadStatuses: [{ thread: THR_A, status: 'resolved' }],
      placements: [
        { ref: LOC_A, parent: 'top-level' },
        { ref: LOC_A, parent: LOC_A },
      ],
      renames: [{ ref: CHAR_A, name: kael }],
    })
  })

  // A handle stands only where a new row's id can: a happening or thread field names a listed one.
  it("maps a listed happening's and thread's placeholders back though a handle spells them", () => {
    const idMap = new IdBiMap()
    const fire = idMap.allocate(HAP_A)
    const relic = idMap.allocate(THR_A)
    const out = substituteClassifierIds(
      {
        newCharacters: [{ handle: fire }, { handle: relic }],
        knownAwareness: [{ happening: fire, ref: fire, source: 'saw it' }],
        threadStatuses: [{ thread: relic, status: 'resolved' }],
      },
      idMap,
      new Set([fire, relic]),
    )
    expect(out).toEqual({
      newCharacters: [{ handle: fire }, { handle: relic }],
      knownAwareness: [{ happening: HAP_A, ref: fire, source: 'saw it' }],
      threadStatuses: [{ thread: THR_A, status: 'resolved' }],
    })
  })

  it('still substitutes placeholders no handle claims', () => {
    const idMap = new IdBiMap()
    const a = idMap.allocate(CHAR_A)
    const b = idMap.allocate(CHAR_B)
    const out = substituteClassifierIds({ subject: a, object: b }, idMap, new Set([b]))
    expect(out).toEqual({ subject: CHAR_A, object: b })
  })

  it('passes non-object values and nulls through', () => {
    const idMap = new IdBiMap()
    expect(substituteClassifierIds({ ref: null, n: 3, ok: true }, idMap)).toEqual({
      ref: null,
      n: 3,
      ok: true,
    })
  })
})
