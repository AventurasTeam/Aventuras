import { describe, expect, it } from 'vitest'

import {
  buildSuggestionSlots,
  findSuggestionAnchor,
  MAX_SUGGESTION_CHARS,
  resolveSuggestionEmission,
  resolveSuggestionItems,
  shouldShowSuggestionStrip,
} from './suggestion-slots'

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

describe('findSuggestionAnchor', () => {
  const e = (id: string, kind: string) => ({ id, kind })

  it('takes the last AI-authored entry', () => {
    expect(
      findSuggestionAnchor([e('a', 'opening'), e('b', 'user_action'), e('c', 'ai_reply')])?.id,
    ).toBe('c')
  })

  it('skips a user_action tail so a turn in flight keeps the last reply’s chips', () => {
    // Otherwise the strip blanks to the empty-state ⟳ Generate the moment the
    // action commits, offering to generate while generation is already running.
    expect(findSuggestionAnchor([e('a', 'ai_reply'), e('b', 'user_action')])?.id).toBe('a')
  })

  it('skips a system tail, whose row clearSystemEntry deletes', () => {
    expect(
      findSuggestionAnchor([e('a', 'ai_reply'), e('b', 'user_action'), e('c', 'system')])?.id,
    ).toBe('a')
  })

  it('is undefined when nothing AI-authored exists yet', () => {
    expect(findSuggestionAnchor([e('a', 'user_action'), e('b', 'system')])).toBeUndefined()
    expect(findSuggestionAnchor([])).toBeUndefined()
  })
})

describe('shouldShowSuggestionStrip', () => {
  const base = {
    suggestionsEnabled: true,
    hasTerminalEntry: true,
    hasChips: false,
    categories: [cat('a')],
  }

  it('shows when enabled with at least one enabled category, even with no chips yet', () => {
    expect(shouldShowSuggestionStrip(base)).toBe(true)
  })

  it('hides when the master toggle is off, even with historical chips', () => {
    expect(shouldShowSuggestionStrip({ ...base, suggestionsEnabled: false, hasChips: true })).toBe(
      false,
    )
  })

  it('hides when there is no terminal entry', () => {
    expect(shouldShowSuggestionStrip({ ...base, hasTerminalEntry: false })).toBe(false)
  })

  it('hides on zero enabled categories with no chips ever emitted (dead Generate button)', () => {
    expect(shouldShowSuggestionStrip({ ...base, categories: [cat('a', false)] })).toBe(false)
  })

  it('still shows historical chips on zero enabled categories', () => {
    expect(
      shouldShowSuggestionStrip({ ...base, categories: [cat('a', false)], hasChips: true }),
    ).toBe(true)
  })
})

describe('resolveSuggestionItems', () => {
  function emission(count: number) {
    return {
      ...buildSuggestionSlots([cat('a', true, 0), cat('b', true, 1)]),
      settingsAllowEmission: true,
      count,
    }
  }

  it('resolves refs to category ids, preserving order', () => {
    const { items } = resolveSuggestionItems(
      [
        { categoryRef: 'cat1', text: 'one' },
        { categoryRef: 'cat2', text: 'two' },
      ],
      emission(5),
    )
    expect(items).toEqual([
      { categoryId: 'a', text: 'one' },
      { categoryId: 'b', text: 'two' },
    ])
  })

  it('trims surrounding whitespace from resolved suggestion text', () => {
    const { items, droppedCount } = resolveSuggestionItems(
      [{ categoryRef: 'cat1', text: '  Draw the blade. \n' }],
      emission(5),
    )
    expect(items).toEqual([{ categoryId: 'a', text: 'Draw the blade.' }])
    expect(droppedCount).toBe(0)
  })

  it('drops whitespace-only suggestion text and counts it as a drop', () => {
    const { items, droppedCount } = resolveSuggestionItems(
      [
        { categoryRef: 'cat1', text: ' \n\t ' },
        { categoryRef: 'cat2', text: 'kept' },
      ],
      emission(5),
    )
    expect(items).toEqual([{ categoryId: 'b', text: 'kept' }])
    expect(droppedCount).toBe(1)
  })

  it('drops an item whose ref does not resolve, keeping the rest', () => {
    const { items, droppedCount } = resolveSuggestionItems(
      [
        { categoryRef: 'cat9', text: 'orphan' },
        { categoryRef: 'cat1', text: 'kept' },
      ],
      emission(5),
    )
    expect(items).toEqual([{ categoryId: 'a', text: 'kept' }])
    expect(droppedCount).toBe(1)
  })

  // A chip's text is inserted into the composer verbatim, and the strip has no
  // way to shrink runaway prose without mangling it, so an over-long one is
  // dropped like an unresolvable ref rather than truncated.
  it('drops an item longer than the character cap, counting it as a drop', () => {
    const { items, droppedCount } = resolveSuggestionItems(
      [
        { categoryRef: 'cat1', text: 'x'.repeat(MAX_SUGGESTION_CHARS + 1) },
        { categoryRef: 'cat2', text: 'kept' },
      ],
      emission(5),
    )
    expect(items).toEqual([{ categoryId: 'b', text: 'kept' }])
    expect(droppedCount).toBe(1)
  })

  it('keeps an item exactly at the character cap', () => {
    const text = 'x'.repeat(MAX_SUGGESTION_CHARS)
    const { items, droppedCount } = resolveSuggestionItems(
      [{ categoryRef: 'cat1', text }],
      emission(5),
    )
    expect(items).toEqual([{ categoryId: 'a', text }])
    expect(droppedCount).toBe(0)
  })

  it('clamps to emission.count without counting the truncation as a drop', () => {
    const { items, droppedCount } = resolveSuggestionItems(
      [
        { categoryRef: 'cat1', text: 'one' },
        { categoryRef: 'cat2', text: 'two' },
      ],
      emission(1),
    )
    expect(items).toEqual([{ categoryId: 'a', text: 'one' }])
    expect(droppedCount).toBe(0)
  })
})
