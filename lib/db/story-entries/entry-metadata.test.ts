import { describe, expect, it } from 'vitest'

import { applyUndoPayload, computeUndoPayload } from '@/lib/actions/delta/delta-encoding'
import { MAX_RETRIEVAL_QUERIES } from '@/lib/piggyback'

import { entryMetadataSchema } from './entry-metadata'

describe('entryMetadataSchema', () => {
  it('accepts a partial AI-authored blob', () => {
    const ok = entryMetadataSchema.safeParse({
      tokens: { prompt: 10, completion: 20 },
      model: 'claude',
      sceneEntities: ['char_x'],
      currentLocationId: null,
      worldTime: 0,
    })
    expect(ok.success).toBe(true)
  })

  it('accepts a complete blob with all optional fields', () => {
    const ok = entryMetadataSchema.safeParse({
      tokens: { prompt: 10, completion: 20, reasoning: 3 },
      model: 'claude-opus-4',
      generationTimingMs: 1200,
      reasoning: 'The character is hiding something.',
      sceneEntities: ['char_x', 'item_y'],
      currentLocationId: 'loc_z',
      worldTime: 600,
      nextTurnSuggestions: {
        items: [{ categoryId: 'cat_1', text: 'Go north' }],
        source: 'piggyback',
      },
    })
    expect(ok.success).toBe(true)
  })

  it('accepts a minimal blob (only required fields)', () => {
    expect(
      entryMetadataSchema.safeParse({ sceneEntities: [], currentLocationId: null, worldTime: 0 })
        .success,
    ).toBe(true)
  })

  it('accepts summary when present and omits it cleanly when absent', () => {
    const parsedWithSummary = entryMetadataSchema.parse({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
      summary: 'The hero enters the dark cave.',
    })
    expect(parsedWithSummary.summary).toBe('The hero enters the dark cave.')

    const parsedWithoutSummary = entryMetadataSchema.parse({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
    })
    expect(parsedWithoutSummary.summary).toBeUndefined()
  })

  it('rejects a negative worldTime', () => {
    expect(
      entryMetadataSchema.safeParse({ sceneEntities: [], currentLocationId: null, worldTime: -1 })
        .success,
    ).toBe(false)
  })

  it('rejects more queries than lib/piggyback caps the emission at', () => {
    const base = { sceneEntities: [], currentLocationId: null, worldTime: 0 }
    const over = Array.from({ length: MAX_RETRIEVAL_QUERIES + 1 }, (_, i) => `q${i}`)
    expect(entryMetadataSchema.safeParse({ ...base, retrievalQueries: over }).success).toBe(false)
    expect(
      entryMetadataSchema.safeParse({ ...base, retrievalQueries: over.slice(0, -1) }).success,
    ).toBe(true)
  })
})

describe('stateReport', () => {
  const base = { sceneEntities: [], currentLocationId: null, worldTime: 0 }

  it('accepts a full report', () => {
    const parsed = entryMetadataSchema.parse({
      ...base,
      stateReport: {
        layer: 'piggyback_tagged_block',
        sceneEntities: ['char_a'],
        currentLocation: 'loc_a',
        worldTimeDelta: 120,
        visualChanges: [{ id: 'char_a', type: 'attire', text: 'muddied cloak' }],
        transfers: {
          items: [{ id: 'item_a', slot: 'inventory', to: 'char_a', from: 'char_b' }],
          stackables: [{ key: 'gold', amount: 50, to: 'char_a' }],
        },
      },
    })
    expect(parsed.stateReport?.layer).toBe('piggyback_tagged_block')
    expect(parsed.stateReport?.transfers?.stackables[0]?.amount).toBe(50)
  })

  it('accepts a failure-only report and keeps the raw text', () => {
    const parsed = entryMetadataSchema.parse({
      ...base,
      stateReport: {
        layer: 'per_turn_classifier',
        failedFields: [{ field: 'transfers', detail: 'content present but no entries' }],
        raw: '<state>\n  <transfers>\n    <item id="i1"',
      },
    })
    expect(parsed.stateReport?.failedFields).toHaveLength(1)
    expect(parsed.stateReport?.raw).toContain('<item id="i1"')
  })

  it('is absent when not supplied — the report is never inherited', () => {
    expect(entryMetadataSchema.parse(base).stateReport).toBeUndefined()
  })

  it('rejects an unknown layer', () => {
    expect(() =>
      entryMetadataSchema.parse({ ...base, stateReport: { layer: 'periodic_classifier' } }),
    ).toThrow()
  })

  // Guards the delta-encoding invariant: a leaf may not stack optional over
  // nullable, so currentLocation is optional-only. A null would be a schema bug,
  // not a legitimate "model said no location".
  it('rejects a null currentLocation', () => {
    expect(() =>
      entryMetadataSchema.parse({
        ...base,
        stateReport: { layer: 'piggyback_tagged_block', currentLocation: null },
      }),
    ).toThrow()
  })

  it('rejects a visual change targeting a category that is not a visual key', () => {
    expect(() =>
      entryMetadataSchema.parse({
        ...base,
        stateReport: {
          layer: 'piggyback_tagged_block',
          visualChanges: [{ id: 'char_a', type: 'traits', text: 'brave' }],
        },
      }),
    ).toThrow()
  })
})

// data-model.md → Entry metadata shape: each create as emitted, with what became of it.
describe('stateReport creates', () => {
  const base = { sceneEntities: [], currentLocationId: null, worldTime: 0 }
  const stateReport = {
    layer: 'piggyback_tagged_block' as const,
    currentLocation: 'loc_docks',
    newLocations: [
      {
        handle: 'new:saltmere',
        name: 'Saltmere',
        description: 'a fishing town',
        outcome: 'created' as const,
        id: 'loc_salt',
      },
      {
        handle: 'new:docks',
        name: "the Smuggler's Docks",
        description: 'a rotting pier',
        parent: 'loc_salt',
        outcome: 'created' as const,
        id: 'loc_docks',
      },
      {
        handle: 'new:inn',
        name: 'The Inn',
        description: '',
        parent: 'new:ghost',
        outcome: 'reused' as const,
        id: 'loc_inn',
        parentDropped: true as const,
      },
      {
        handle: 'new:alley',
        name: 'an alley',
        description: 'passing through',
        outcome: 'dropped' as const,
      },
    ],
    newItems: [
      {
        handle: 'new:key',
        name: 'rusted key',
        description: 'an iron key',
        outcome: 'created' as const,
        id: 'item_key',
      },
      { handle: 'new:apple', name: 'apple', description: '', outcome: 'dropped' as const },
    ],
  }

  it('round-trips every create outcome', () => {
    expect(entryMetadataSchema.parse({ ...base, stateReport })).toEqual({ ...base, stateReport })
  })

  it('rejects a reused item: an item is never reused', () => {
    const reused = {
      layer: 'per_turn_classifier',
      newItems: [{ handle: 'new:key', name: 'key', description: '', outcome: 'reused', id: 'i' }],
    }
    expect(entryMetadataSchema.safeParse({ ...base, stateReport: reused }).success).toBe(false)
  })

  // Literal true, as with currentLocationRejected: absence is the only other state.
  it('rejects a parentDropped of false', () => {
    const notDropped = {
      layer: 'per_turn_classifier',
      newLocations: [
        {
          handle: 'new:a',
          name: 'A',
          description: '',
          outcome: 'created',
          id: 'loc_a',
          parentDropped: false,
        },
      ],
    }
    expect(entryMetadataSchema.safeParse({ ...base, stateReport: notDropped }).success).toBe(false)
  })

  it.each([
    ['newLocations', 'created'],
    ['newLocations', 'reused'],
    ['newItems', 'created'],
  ] as const)('rejects a %s create %s without the id of its row', (field, outcome) => {
    const report = {
      layer: 'per_turn_classifier',
      [field]: [{ handle: 'new:a', name: 'A', description: '', outcome }],
    }
    expect(entryMetadataSchema.safeParse({ ...base, stateReport: report }).success).toBe(false)
  })

  // A fallback rewrites a failed fold's dropped creates as created; undo restores them whole.
  it("undoes a report's creates to the lists before the write", () => {
    const dropped = {
      layer: 'piggyback_tagged_block' as const,
      newLocations: [stateReport.newLocations[3]],
      newItems: [stateReport.newItems[1]],
    }
    const current = { ...base, stateReport: dropped }
    const next = { ...base, stateReport: { ...stateReport, layer: 'per_turn_classifier' as const } }
    const undo = computeUndoPayload(entryMetadataSchema, current, next)
    expect(applyUndoPayload(entryMetadataSchema, next, undo)).toEqual(current)
  })
})

describe('systemFailure', () => {
  const base = { sceneEntities: [], currentLocationId: null, worldTime: 0 }

  it.each(['failed', 'held', 'resolved'] as const)('keeps a pass entry marked %s', (pass) => {
    const systemFailure = { kind: 'provider', detail: 'timeout: classifier', pass }
    expect(entryMetadataSchema.parse({ ...base, systemFailure })).toEqual({
      ...base,
      systemFailure,
    })
  })

  it('rejects a pass marker it does not know', () => {
    const systemFailure = { kind: 'provider', pass: 'pending' }
    expect(entryMetadataSchema.safeParse({ ...base, systemFailure }).success).toBe(false)
  })

  it('leaves a turn failure unmarked', () => {
    const parsed = entryMetadataSchema.parse({ ...base, systemFailure: { kind: 'provider' } })
    expect(parsed.systemFailure).not.toHaveProperty('pass')
  })
})

// data-model.md → Entry metadata shape.
describe('stateReport conditions and drops', () => {
  const base = { sceneEntities: [], currentLocationId: null, worldTime: 0 }
  const stateReport = {
    layer: 'piggyback_tagged_block' as const,
    conditions: [{ id: 'loc_a', text: 'burned to the ground' }],
    transfers: {
      items: [{ id: 'item_a', slot: 'inventory' as const, to: 'char_a' }],
      stackables: [],
      drops: [
        { id: 'item_b', from: 'char_a', at: 'loc_a' },
        { id: 'item_c', at: null },
      ],
    },
    newLocations: [
      {
        handle: 'new:a',
        name: 'A',
        description: '',
        condition: 'scorched',
        outcome: 'created' as const,
        id: 'loc_new',
      },
    ],
    newItems: [
      {
        handle: 'new:k',
        name: 'key',
        description: '',
        condition: 'bent',
        outcome: 'dropped' as const,
      },
    ],
  }

  it('round-trips conditions, drops and a create condition', () => {
    expect(entryMetadataSchema.parse({ ...base, stateReport })).toEqual({ ...base, stateReport })
  })

  it('reads a stored report from before drops', () => {
    const before = {
      layer: 'piggyback_tagged_block' as const,
      transfers: { items: [], stackables: [] },
    }
    expect(entryMetadataSchema.parse({ ...base, stateReport: before }).stateReport).toEqual(before)
  })

  // Null, never absent: the panel tells "landed nowhere" from a record that lost its place.
  it('rejects a drop with no place', () => {
    const report = {
      layer: 'piggyback_tagged_block',
      transfers: { items: [], stackables: [], drops: [{ id: 'item_b' }] },
    }
    expect(entryMetadataSchema.safeParse({ ...base, stateReport: report }).success).toBe(false)
  })

  // The schema is the metadata undo encoder: a key it lacks would outlive the undo.
  it("undoes a fallback's conditions and drops to the report before it", () => {
    const current = {
      ...base,
      stateReport: {
        layer: 'piggyback_tagged_block' as const,
        transfers: { items: [], stackables: [] },
      },
    }
    const next = { ...base, stateReport: { ...stateReport, layer: 'per_turn_classifier' as const } }
    const undo = computeUndoPayload(entryMetadataSchema, current, next)
    expect(applyUndoPayload(entryMetadataSchema, next, undo)).toEqual(current)
  })
})

// data-model.md → Entry metadata shape → Cut-off mark.
describe('cutOff', () => {
  const base = { sceneEntities: [], currentLocationId: null, worldTime: 0 }

  it.each([
    { cause: 'max-output', outputTokens: 4096, limit: 4096 },
    { cause: 'window', outputTokens: 1200, limit: 65536 },
    { cause: 'unknown' },
  ])('keeps a $cause mark with its numbers', (mark) => {
    expect(entryMetadataSchema.parse({ ...base, cutOff: mark }).cutOff).toEqual(mark)
  })

  it('rejects a cause it does not know', () => {
    expect(entryMetadataSchema.safeParse({ ...base, cutOff: { cause: 'context' } }).success).toBe(
      false,
    )
  })

  it.each([
    { cause: 'max-output', outputTokens: 512 },
    { cause: 'window' },
    { cause: 'unknown', limit: 5 },
  ])('rejects a $cause mark whose limit does not match its cause', (mark) => {
    expect(entryMetadataSchema.safeParse({ ...base, cutOff: mark }).success).toBe(false)
  })

  // The schema drives the metadata undo encoder: a key it lacks is lost on undo.
  it.each([
    { cause: 'max-output' as const, outputTokens: 512, limit: 512 },
    { cause: 'unknown' as const, outputTokens: 300 },
  ])('undoes a cleared $cause mark back onto the metadata', (cutOff) => {
    const marked = { ...base, cutOff }
    const undo = computeUndoPayload(entryMetadataSchema, marked, base)
    expect(applyUndoPayload(entryMetadataSchema, base, undo)).toEqual(marked)
  })
})
