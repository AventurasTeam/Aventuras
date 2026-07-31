import { describe, expect, it } from 'vitest'

import type { SuggestionCategory as StoredCategory } from '@/lib/db'
import { CURATED_ACCENT_PALETTE } from '@/lib/themes'

import {
  SUGGESTION_SWATCHES,
  sameStoredCategories,
  toDraft,
  toStored,
  validateDraft,
} from './suggestion-categories-draft'

const stored = (over: Partial<StoredCategory> = {}): StoredCategory => ({
  id: 'a',
  label: 'Action',
  promptHint: 'hint',
  color: 'red',
  enabled: true,
  order: 0,
  ...over,
})

describe('toDraft', () => {
  it('orders by `order`, not by array position', () => {
    const draft = toDraft([
      stored({ id: 'b', label: 'B', order: 1 }),
      stored({ id: 'a', label: 'A', order: 0 }),
    ])
    expect(draft.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('resolves a curated slot key to its palette hex', () => {
    expect(toDraft([stored({ color: 'blue' })])[0]?.color).toBe(CURATED_ACCENT_PALETTE.blue)
  })

  it('passes a raw hex through', () => {
    expect(toDraft([stored({ color: '#7c3aed' })])[0]?.color).toBe('#7c3aed')
  })

  it('maps an empty colour to null so the editor shows its fallback swatch', () => {
    expect(toDraft([stored({ color: '' })])[0]?.color).toBeNull()
  })

  it('maps an unresolvable colour to null rather than to neutral', () => {
    expect(toDraft([stored({ color: 'chartreuse' })])[0]?.color).toBeNull()
  })
})

describe('toStored', () => {
  it('writes `order` from array position', () => {
    const out = toStored([
      { id: 'b', label: 'B', color: null, promptHint: '', enabled: true },
      { id: 'a', label: 'A', color: null, promptHint: '', enabled: false },
    ])
    expect(out.map((c) => [c.id, c.order])).toEqual([
      ['b', 0],
      ['a', 1],
    ])
  })

  it('folds a palette hex back to its slot key', () => {
    const out = toStored([
      { id: 'a', label: 'A', color: CURATED_ACCENT_PALETTE.teal, promptHint: '', enabled: true },
    ])
    expect(out[0]?.color).toBe('teal')
  })

  it('keeps a custom hex raw', () => {
    const out = toStored([{ id: 'a', label: 'A', color: '#7c3aed', promptHint: '', enabled: true }])
    expect(out[0]?.color).toBe('#7c3aed')
  })

  it('writes an empty string for no colour', () => {
    const out = toStored([{ id: 'a', label: 'A', color: null, promptHint: '', enabled: true }])
    expect(out[0]?.color).toBe('')
  })
})

describe('round-trip', () => {
  it('preserves a mixed list through toDraft → toStored', () => {
    const input: StoredCategory[] = [
      stored({ id: 'a', color: 'red', order: 0 }),
      stored({ id: 'b', label: 'Custom', color: '#7c3aed', order: 1, enabled: false }),
      stored({ id: 'c', label: 'Bare', color: '', order: 2 }),
    ]
    expect(toStored(toDraft(input))).toEqual(input)
  })
})

describe('validateDraft', () => {
  const row = (id: string, label: string) => ({
    id,
    label,
    color: null,
    promptHint: '',
    enabled: true,
  })

  it('accepts distinct non-empty labels', () => {
    expect(validateDraft([row('a', 'Action'), row('b', 'Dialogue')])).toEqual({ ok: true })
  })

  it('accepts an empty list', () => {
    expect(validateDraft([])).toEqual({ ok: true })
  })

  it('rejects an empty label', () => {
    expect(validateDraft([row('a', '   ')])).toEqual({ ok: false, problem: 'empty-label' })
  })

  it('rejects a case-insensitive duplicate', () => {
    expect(validateDraft([row('a', 'Action'), row('b', 'action')])).toEqual({
      ok: false,
      problem: 'duplicate-label',
    })
  })

  it('reports the empty label first when both problems are present', () => {
    expect(validateDraft([row('a', ''), row('b', 'X'), row('c', 'x')])).toEqual({
      ok: false,
      problem: 'empty-label',
    })
  })
})

describe('sameStoredCategories', () => {
  const base = [stored({ id: 'a', order: 0 }), stored({ id: 'b', label: 'B', order: 1 })]

  it('is true for an identical list', () => {
    expect(sameStoredCategories(base, [...base])).toBe(true)
  })

  it('detects a reorder', () => {
    const swapped = [
      { ...base[1]!, order: 0 },
      { ...base[0]!, order: 1 },
    ]
    expect(sameStoredCategories(base, swapped)).toBe(false)
  })

  it('detects a rename, a recolour, and an enable flip', () => {
    expect(sameStoredCategories(base, [{ ...base[0]!, label: 'Z' }, base[1]!])).toBe(false)
    expect(sameStoredCategories(base, [{ ...base[0]!, color: 'teal' }, base[1]!])).toBe(false)
    expect(sameStoredCategories(base, [{ ...base[0]!, enabled: false }, base[1]!])).toBe(false)
  })

  it('detects an added or removed row', () => {
    expect(sameStoredCategories(base, [base[0]!])).toBe(false)
  })
})

describe('SUGGESTION_SWATCHES', () => {
  it('is the curated palette, in slot order', () => {
    expect(SUGGESTION_SWATCHES).toEqual(Object.values(CURATED_ACCENT_PALETTE))
  })
})
