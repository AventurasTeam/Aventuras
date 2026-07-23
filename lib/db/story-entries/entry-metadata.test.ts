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
