import { describe, expect, it } from 'vitest'

import { STRUCTURED_SHAPES } from './shapes'
import { EXAMPLES } from '../../e2e/harness/mock-llm'

// The registry is shared with the E2E harness but the default replies are not.
// These assertions are the seam: they fail when a shape is added to the shared
// list without giving the suite something valid to answer with, which would
// otherwise surface as `undefined` in a completion body mid-run.
describe('E2E harness examples', () => {
  it('covers every registered shape', () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(STRUCTURED_SHAPES.map((s) => s.name).sort())
  })

  it('answers each shape with a value that shape accepts', () => {
    for (const shape of STRUCTURED_SHAPES) {
      const result = shape.schema.safeParse(EXAMPLES[shape.name])
      expect(result.success, `${shape.name}: ${result.error?.message ?? ''}`).toBe(true)
    }
  })

  it('keeps the suggestion-refresh default resolvable, since an empty one fails the run', () => {
    const value = EXAMPLES['suggestion-refresh'] as { suggestions: unknown[] }
    expect(value.suggestions).toHaveLength(1)
  })

  it('keeps the classifier defaults inert so a spec that sets nothing writes nothing', () => {
    expect(EXAMPLES['per-turn-classifier']).toEqual({ sceneEntities: [], worldTimeDelta: 0 })
    expect(EXAMPLES['periodic-classifier']).toEqual({
      happenings: [],
      relationships: [],
      statusFlips: [],
      newCharacters: [],
    })
  })
})
