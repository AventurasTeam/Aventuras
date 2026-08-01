import { describe, expect, it } from 'vitest'

import { categoryLabelKey, findDuplicateLabelIds } from './suggestion-category-labels'

describe('categoryLabelKey', () => {
  it('collapses case and surrounding space to one identity', () => {
    expect(categoryLabelKey('  Combat ')).toBe(categoryLabelKey('combat'))
  })
})

describe('findDuplicateLabelIds', () => {
  it('returns every id in a colliding group, not just the later one', () => {
    const dups = findDuplicateLabelIds([
      { id: 'a', label: 'Action' },
      { id: 'b', label: 'action' },
      { id: 'c', label: 'Dialogue' },
    ])
    expect([...dups].sort()).toEqual(['a', 'b'])
  })

  // Blank labels are the empty-label error, so grouping them here would report
  // every unfilled new row as a duplicate of every other.
  it('ignores blank labels', () => {
    const dups = findDuplicateLabelIds([
      { id: 'a', label: '   ' },
      { id: 'b', label: '' },
    ])
    expect(dups.size).toBe(0)
  })
})
