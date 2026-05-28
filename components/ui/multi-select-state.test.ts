import { describe, expect, it } from 'vitest'

import {
  clearAll,
  computeSelectionState,
  normalizeSelection,
  selectAll,
  selectionLabel,
  toggleValue,
  type MultiSelectOption,
} from './multi-select-state'

const OPTIONS: MultiSelectOption[] = [
  { value: 'classifier' },
  { value: 'retrieval' },
  { value: 'provider', disabled: true },
  { value: 'embedder' },
]

describe('normalizeSelection', () => {
  it('coerces an array to a Set', () => {
    const result = normalizeSelection(['classifier', 'retrieval'], OPTIONS)
    expect(result).toEqual(new Set(['classifier', 'retrieval']))
  })

  it('coerces a Set through unchanged', () => {
    const input = new Set(['classifier'])
    expect(normalizeSelection(input, OPTIONS)).toEqual(input)
  })

  it('drops values not present in options (stale selections)', () => {
    const result = normalizeSelection(['classifier', 'gone'], OPTIONS)
    expect(result).toEqual(new Set(['classifier']))
  })

  it('handles empty selection', () => {
    expect(normalizeSelection([], OPTIONS)).toEqual(new Set())
  })
})

describe('computeSelectionState', () => {
  it('returns "all" when every option is selected', () => {
    const selected = new Set(['classifier', 'retrieval', 'provider', 'embedder'])
    expect(computeSelectionState(selected, OPTIONS)).toEqual({ kind: 'all' })
  })

  it('returns "none" when no option is selected', () => {
    expect(computeSelectionState(new Set(), OPTIONS)).toEqual({ kind: 'none' })
  })

  it('returns partial counts otherwise', () => {
    const selected = new Set(['classifier', 'retrieval'])
    expect(computeSelectionState(selected, OPTIONS)).toEqual({
      kind: 'partial',
      selectedCount: 2,
      total: 4,
    })
  })
})

describe('selectionLabel', () => {
  it('returns "all" for all', () => {
    expect(selectionLabel({ kind: 'all' })).toBe('all')
  })

  it('returns "none" for none', () => {
    expect(selectionLabel({ kind: 'none' })).toBe('none')
  })

  it('returns "N of M" for partial', () => {
    expect(selectionLabel({ kind: 'partial', selectedCount: 2, total: 4 })).toBe('2 of 4')
  })
})

describe('toggleValue', () => {
  it('adds a missing value', () => {
    const next = toggleValue(new Set(['classifier']), 'retrieval')
    expect(next).toEqual(new Set(['classifier', 'retrieval']))
  })

  it('removes an existing value', () => {
    const next = toggleValue(new Set(['classifier', 'retrieval']), 'classifier')
    expect(next).toEqual(new Set(['retrieval']))
  })

  it('returns a new Set instance (does not mutate)', () => {
    const input = new Set(['classifier'])
    const next = toggleValue(input, 'retrieval')
    expect(next).not.toBe(input)
    expect(input).toEqual(new Set(['classifier']))
  })
})

describe('selectAll', () => {
  it('returns a Set of every option value (including disabled)', () => {
    expect(selectAll(OPTIONS)).toEqual(new Set(['classifier', 'retrieval', 'provider', 'embedder']))
  })
})

describe('clearAll', () => {
  it('returns an empty Set', () => {
    expect(clearAll()).toEqual(new Set())
  })
})
