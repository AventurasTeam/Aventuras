import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { IdBiMap } from '@/lib/ids'

import { classifierExtractionSchema } from './schema'
import { PLACEHOLDER_FIELDS, substituteClassifierIds } from './substitute'

const CHAR_A = 'char_11111111-1111-1111-1111-111111111111'
const CHAR_B = 'char_22222222-2222-2222-2222-222222222222'

/** Every string-valued property name the wire schema declares, at any depth. */
function stringFieldsOf(schema: z.ZodType): string[] {
  const found = new Set<string>()
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    const properties = record.properties as Record<string, unknown> | undefined
    if (properties) {
      for (const [name, child] of Object.entries(properties)) {
        if ((child as { type?: string }).type === 'string') found.add(name)
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
  'description',
  'handle',
  'kind',
  'learnedAtTurn',
  'name',
  'occurredAtTurn',
  'reason',
  'role',
  'source',
  'sourceTurn',
  'temporal',
  'title',
  'to',
]

describe('PLACEHOLDER_FIELDS', () => {
  // The link plan.ts's four resolveRef call sites and this list otherwise lack:
  // a fifth ref-bearing field in the schema fails here until it is classified,
  // instead of silently never resolving and landing in unresolvedRefs.
  it('partitions every string field the schema declares into ref-bearing or not', () => {
    expect(stringFieldsOf(classifierExtractionSchema)).toEqual(
      [...PLACEHOLDER_FIELDS, ...NON_REF_FIELDS].sort(),
    )
  })

  it('does not overlap the non-reference fields', () => {
    expect(PLACEHOLDER_FIELDS.filter((f) => NON_REF_FIELDS.includes(f))).toEqual([])
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

  it('leaves an unknown ref untouched so the planner can resolve or report it', () => {
    const idMap = new IdBiMap()
    // 'nc1' is a newCharacters temp handle; 'c9' was never allocated.
    const out = substituteClassifierIds({ ref: 'nc1', subject: 'c9' }, idMap)
    expect(out).toEqual({ ref: 'nc1', subject: 'c9' })
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
