import { describe, expect, it } from 'vitest'

import { buildSuggestionSlots, resolveSuggestionEmission } from './suggestion-slots'

const cat = (id: string, enabled = true, order = 0) => ({
  id,
  label: `L-${id}`,
  promptHint: `H-${id}`,
  color: 'blue',
  enabled,
  order,
})

describe('buildSuggestionSlots', () => {
  it('numbers enabled categories cat1..catN in order', () => {
    const { slots } = buildSuggestionSlots([cat('a', true, 1), cat('b', true, 0)])
    expect(slots).toEqual([
      { ref: 'cat1', label: 'L-b', promptHint: 'H-b' },
      { ref: 'cat2', label: 'L-a', promptHint: 'H-a' },
    ])
  })

  it('excludes disabled categories from the slot list', () => {
    const { slots } = buildSuggestionSlots([cat('a', false, 0), cat('b', true, 1)])
    expect(slots.map((s) => s.label)).toEqual(['L-b'])
  })

  it('resolves a ref back to its category id', () => {
    const { resolveCategoryId } = buildSuggestionSlots([cat('a', true, 0)])
    expect(resolveCategoryId('cat1')).toBe('a')
  })

  it('returns undefined for an unknown ref rather than inventing an id', () => {
    const { resolveCategoryId } = buildSuggestionSlots([cat('a', true, 0)])
    expect(resolveCategoryId('cat9')).toBeUndefined()
    expect(resolveCategoryId('a')).toBeUndefined()
  })

  it('falls back to the label as the hint when promptHint is empty', () => {
    const { slots } = buildSuggestionSlots([{ ...cat('a'), promptHint: '   ' }])
    expect(slots[0].promptHint).toBe('L-a')
  })
})

describe('resolveSuggestionEmission', () => {
  const base = { suggestionsEnabled: true, suggestionCount: 3, suggestionCategories: [cat('a')] }

  it('allows emission when enabled with at least one enabled category', () => {
    expect(resolveSuggestionEmission(base).settingsAllowEmission).toBe(true)
  })

  it('disallows emission when the master toggle is off', () => {
    expect(
      resolveSuggestionEmission({ ...base, suggestionsEnabled: false }).settingsAllowEmission,
    ).toBe(false)
  })

  it('disallows emission when every category is disabled', () => {
    expect(
      resolveSuggestionEmission({ ...base, suggestionCategories: [cat('a', false)] })
        .settingsAllowEmission,
    ).toBe(false)
  })

  it('disallows emission when the palette is empty', () => {
    expect(
      resolveSuggestionEmission({ ...base, suggestionCategories: [] }).settingsAllowEmission,
    ).toBe(false)
  })

  it('carries the chip count through', () => {
    expect(resolveSuggestionEmission({ ...base, suggestionCount: 5 }).count).toBe(5)
  })
})
