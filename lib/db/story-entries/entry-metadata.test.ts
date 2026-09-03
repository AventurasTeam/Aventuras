import { describe, expect, it } from 'vitest'

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
