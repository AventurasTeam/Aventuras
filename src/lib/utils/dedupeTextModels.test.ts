import { describe, it, expect } from 'vitest'
import { dedupeTextModels } from './dedupeTextModels'
import type { TextModel } from '$lib/types'

/**
 * Model lists arrive from several places at once -- a provider's `/models`, a hardcoded
 * fallback, whatever the user typed by hand -- and the same id routinely appears in more than
 * one of them with different capability flags. Losing a `reasoning: true` in the merge means
 * the reasoning controls disappear from a model that supports them, which reads as the app
 * not supporting the feature rather than as a list bug.
 */

const model = (id: string, extra: Partial<TextModel> = {}): TextModel => ({ id, ...extra })

describe('dedupeTextModels', () => {
  it('keeps distinct ids untouched and in order', () => {
    const result = dedupeTextModels([model('a'), model('b'), model('c')])
    expect(result.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('collapses duplicate ids into one entry', () => {
    const result = dedupeTextModels([model('a'), model('a'), model('b')])
    expect(result.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('keeps the position of the first occurrence', () => {
    // The order is the order the picker shows, and the first list is the authoritative one.
    const result = dedupeTextModels([model('a'), model('b'), model('a')])
    expect(result.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('trims whitespace around ids', () => {
    expect(dedupeTextModels([model('  a  ')])[0].id).toBe('a')
  })

  it('treats ids differing only by whitespace as the same model', () => {
    expect(dedupeTextModels([model('a'), model(' a ')])).toHaveLength(1)
  })

  it('drops entries with an empty id', () => {
    // An empty id cannot be selected or sent; keeping it puts a blank row in the picker.
    expect(dedupeTextModels([model(''), model('   '), model('a')]).map((m) => m.id)).toEqual(['a'])
  })

  describe('capability merging', () => {
    it('keeps reasoning when only the later duplicate declares it', () => {
      const result = dedupeTextModels([model('a'), model('a', { reasoning: true })])
      expect(result[0].reasoning).toBe(true)
    })

    it('keeps reasoning when only the first declares it', () => {
      const result = dedupeTextModels([model('a', { reasoning: true }), model('a')])
      expect(result[0].reasoning).toBe(true)
    })

    it('keeps structuredOutput from whichever duplicate declares it', () => {
      const result = dedupeTextModels([model('a'), model('a', { structuredOutput: true })])
      expect(result[0].structuredOutput).toBe(true)
    })

    it('leaves a capability undefined rather than false when nobody declares it', () => {
      const result = dedupeTextModels([model('a'), model('a')])
      expect(result[0].reasoning).toBeUndefined()
      expect(result[0].structuredOutput).toBeUndefined()
    })

    it('keeps an explicit false over a later undefined', () => {
      const result = dedupeTextModels([model('a', { reasoning: false }), model('a')])
      expect(result[0].reasoning).toBe(false)
    })

    it('keeps an explicit false from the later duplicate', () => {
      const result = dedupeTextModels([model('a'), model('a', { reasoning: false })])
      expect(result[0].reasoning).toBe(false)
    })
  })

  it('returns an empty list unchanged', () => {
    expect(dedupeTextModels([])).toEqual([])
  })
})
