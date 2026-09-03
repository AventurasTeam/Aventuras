import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { entryMetadataSchema } from '@/lib/db'

import { applyUndoPayload, computeUndoPayload } from './delta-encoding'

// Fixture covers every node type the engines discriminate:
// nullable scalar, nullable object, record (dynamic-keyed), optional scalar,
// optional array, nested object.
const fixture = z.object({
  name: z.string(), // plain scalar
  loc: z.string().nullable(), // nullable scalar  -> null = restore value
  voice: z.string().optional(), // optional scalar  -> null = delete key
  tags: z.array(z.string()).optional(), // optional array   -> whole-array replace
  stack: z.record(z.string(), z.number()), // record           -> null sub-key = delete sub-key
  vis: z
    .object({ portrait: z.string(), distinguishing: z.array(z.string()).optional() })
    .nullable(), // nullable object
})

describe('computeUndoPayload + applyUndoPayload', () => {
  it('nullable scalar: non-null -> non-null stores pre-value', () => {
    const cur = { name: 'k', loc: 'forest', stack: {} }
    const next = { name: 'k', loc: 'cave', stack: {} }
    const undo = computeUndoPayload(fixture, cur, next)
    expect(undo).toEqual({ loc: 'forest' })
    expect(applyUndoPayload(fixture, next, undo)).toEqual(cur)
  })

  it('nullable scalar: non-null -> null stores pre-value, null -> non-null stores null', () => {
    const cur = { name: 'k', loc: 'forest', stack: {} }
    const next = { name: 'k', loc: null, stack: {} }
    expect(computeUndoPayload(fixture, cur, next)).toEqual({ loc: 'forest' })
    expect(applyUndoPayload(fixture, next, { loc: 'forest' })).toEqual(cur)
    // reverse direction
    expect(computeUndoPayload(fixture, next, cur)).toEqual({ loc: null })
    expect(applyUndoPayload(fixture, cur, { loc: null })).toEqual(next)
  })

  it('optional scalar: absent -> present stores null sentinel (delete key on undo)', () => {
    const cur = { name: 'k', stack: {} }
    const next = { name: 'k', voice: 'gruff', stack: {} }
    expect(computeUndoPayload(fixture, cur, next)).toEqual({ voice: null })
    expect(applyUndoPayload(fixture, next, { voice: null })).toEqual(cur)
  })

  it('optional scalar: present -> absent stores pre-value', () => {
    const cur = { name: 'k', voice: 'gruff', stack: {} }
    const next = { name: 'k', stack: {} }
    expect(computeUndoPayload(fixture, cur, next)).toEqual({ voice: 'gruff' })
    expect(applyUndoPayload(fixture, next, { voice: 'gruff' })).toEqual(cur)
  })

  it('record: changed key stores pre-value, added key stores null sentinel', () => {
    const cur = { name: 'k', stack: { gold: 5 } }
    const next = { name: 'k', stack: { gold: 9, silver: 2 } }
    expect(computeUndoPayload(fixture, cur, next)).toEqual({ stack: { gold: 5, silver: null } })
    expect(applyUndoPayload(fixture, next, { stack: { gold: 5, silver: null } })).toEqual(cur)
  })

  it('nullable object: non-null -> null stores full pre-object', () => {
    const cur = { name: 'k', stack: {}, vis: { portrait: 'p1', distinguishing: ['scar'] } }
    const next = { name: 'k', stack: {}, vis: null }
    expect(computeUndoPayload(fixture, cur, next)).toEqual({
      vis: { portrait: 'p1', distinguishing: ['scar'] },
    })
    expect(applyUndoPayload(fixture, next, computeUndoPayload(fixture, cur, next))).toEqual(cur)
  })

  it('nullable object: non-null -> non-null stores nested partial', () => {
    const cur = { name: 'k', stack: {}, vis: { portrait: 'p1' } }
    const next = { name: 'k', stack: {}, vis: { portrait: 'p2' } }
    expect(computeUndoPayload(fixture, cur, next)).toEqual({ vis: { portrait: 'p1' } })
    expect(applyUndoPayload(fixture, next, { vis: { portrait: 'p1' } })).toEqual(cur)
  })

  it('round-trip: apply(next, diff(cur,next)) === cur across pairs', () => {
    const pairs: [Record<string, unknown>, Record<string, unknown>][] = [
      [
        { name: 'a', loc: 'x', stack: { g: 1 } },
        { name: 'a', loc: null, stack: { g: 2, s: 1 } },
      ],
      [
        { name: 'a', voice: 'v', stack: {}, vis: { portrait: 'p' } },
        { name: 'a', stack: {}, vis: null },
      ],
      [
        { name: 'a', tags: ['t1'], stack: {} },
        { name: 'a', tags: ['t2', 't3'], stack: {} },
      ],
    ]
    for (const [cur, next] of pairs) {
      const undo = computeUndoPayload(fixture, cur, next)
      expect(applyUndoPayload(fixture, next, undo)).toEqual(cur)
    }
  })

  it('no-change column produces empty undo payload', () => {
    const cur = { name: 'k', loc: 'x', stack: { g: 1 } }
    expect(computeUndoPayload(fixture, cur, { ...cur })).toEqual({})
  })
})

// The real entry-metadata schema rather than a fixture: stateReport is the first
// nested optional object on a delta-logged column, and the scene editor's write
// depends on it staying out of a payload it never touched.
describe('stateReport round-trip through entryMetadataSchema', () => {
  const base = { sceneEntities: ['char_a'], currentLocationId: 'loc_a', worldTime: 100 }

  it('restores an absent report on undo', () => {
    const current = { ...base }
    const next = { ...base, stateReport: { layer: 'piggyback_tagged_block' as const } }
    const undo = computeUndoPayload(entryMetadataSchema, current, next)
    expect(applyUndoPayload(entryMetadataSchema, next, undo)).toEqual(current)
  })

  it('restores a prior report field-wise', () => {
    const current = {
      ...base,
      stateReport: { layer: 'piggyback_tagged_block' as const, worldTimeDelta: 120 },
    }
    const next = {
      ...base,
      stateReport: { layer: 'per_turn_classifier' as const, worldTimeDelta: 60 },
    }
    const undo = computeUndoPayload(entryMetadataSchema, current, next)
    expect(applyUndoPayload(entryMetadataSchema, next, undo)).toEqual(current)
  })

  // The scene edit is the only mutation touching the absolute triple while leaving
  // the report alone — an untouched report must not appear in the undo payload.
  it('leaves the report out of the payload when only the scene changed', () => {
    const report = { layer: 'piggyback_tagged_block' as const, worldTimeDelta: 120 }
    const current = { ...base, stateReport: report }
    const next = { ...base, sceneEntities: ['char_a', 'char_b'], stateReport: report }
    const undo = computeUndoPayload(entryMetadataSchema, current, next)
    expect(undo).not.toHaveProperty('stateReport')
    expect(applyUndoPayload(entryMetadataSchema, next, undo)).toEqual(current)
  })

  it('restores a nested report array whole', () => {
    const current = {
      ...base,
      stateReport: {
        layer: 'piggyback_tagged_block' as const,
        visualChanges: [{ id: 'char_a', type: 'attire' as const, text: 'clean cloak' }],
      },
    }
    const next = {
      ...base,
      stateReport: {
        layer: 'piggyback_tagged_block' as const,
        visualChanges: [{ id: 'char_a', type: 'attire' as const, text: 'muddied cloak' }],
      },
    }
    const undo = computeUndoPayload(entryMetadataSchema, current, next)
    expect(applyUndoPayload(entryMetadataSchema, next, undo)).toEqual(current)
  })
})
