import { describe, expect, it } from 'vitest'

import { CURATED_ACCENT_SLOTS } from '@/lib/themes'

import { DEFAULT_SUGGESTION_CATEGORIES } from './default-suggestion-categories'
import { suggestionCategorySchema } from './story-config-schema'

describe('DEFAULT_SUGGESTION_CATEGORIES', () => {
  it('ships the canonical adventure palette', () => {
    expect(DEFAULT_SUGGESTION_CATEGORIES.adventure.map((c) => c.label)).toEqual([
      'Action',
      'Dialogue',
      'Examine',
      'Move',
    ])
  })

  it('ships the canonical creative palette', () => {
    expect(DEFAULT_SUGGESTION_CATEGORIES.creative.map((c) => c.label)).toEqual([
      'Action',
      'Dialogue',
      'Revelation',
      'Twist',
    ])
  })

  it('validates against the persisted schema', () => {
    for (const mode of ['adventure', 'creative'] as const) {
      for (const category of DEFAULT_SUGGESTION_CATEGORIES[mode]) {
        expect(() => suggestionCategorySchema.parse(category)).not.toThrow()
      }
    }
  })

  it('numbers order contiguously from zero and enables everything', () => {
    for (const mode of ['adventure', 'creative'] as const) {
      const list = DEFAULT_SUGGESTION_CATEGORIES[mode]
      expect(list.map((c) => c.order)).toEqual(list.map((_, i) => i))
      expect(list.every((c) => c.enabled)).toBe(true)
    }
  })

  it('keeps ids unique within each palette', () => {
    for (const mode of ['adventure', 'creative'] as const) {
      const list = DEFAULT_SUGGESTION_CATEGORIES[mode]
      expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
    }
  })

  it('uses curated palette slot keys, never raw hex', () => {
    for (const mode of ['adventure', 'creative'] as const) {
      for (const category of DEFAULT_SUGGESTION_CATEGORIES[mode]) {
        expect(CURATED_ACCENT_SLOTS).toContain(category.color)
      }
    }
  })
})
