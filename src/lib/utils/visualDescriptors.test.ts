import { describe, it, expect } from 'vitest'
import {
  descriptorsToString,
  stringToDescriptors,
  hasDescriptors,
} from '$lib/utils/visualDescriptors'

describe('descriptorsToString', () => {
  it('renders in the fixed category order, not the object key order', () => {
    expect(descriptorsToString({ eyes: 'green', face: 'round', hair: 'red' })).toBe(
      'Face: round, Hair: red, Eyes: green',
    )
  })

  it('skips empty categories rather than emitting empty labels', () => {
    expect(descriptorsToString({ face: 'round', hair: '', eyes: undefined })).toBe('Face: round')
  })

  it('returns an empty string for null/undefined/empty', () => {
    expect(descriptorsToString(null)).toBe('')
    expect(descriptorsToString(undefined)).toBe('')
    expect(descriptorsToString({})).toBe('')
  })
})

describe('stringToDescriptors', () => {
  it('parses the labelled form back into an object', () => {
    expect(stringToDescriptors('Face: round, Hair: red, Eyes: green')).toEqual({
      face: 'round',
      hair: 'red',
      eyes: 'green',
    })
  })

  it('accepts labels in any case', () => {
    expect(stringToDescriptors('face: round, HAIR: red')).toEqual({ face: 'round', hair: 'red' })
  })

  it('keeps commas inside a value, since labels are what delimit fields', () => {
    expect(stringToDescriptors('Hair: long, braided, silver, Eyes: green')).toEqual({
      hair: 'long, braided, silver',
      eyes: 'green',
    })
  })

  it('round-trips whatever descriptorsToString produced', () => {
    const original = {
      face: 'sharp cheekbones',
      hair: 'long, braided',
      eyes: 'green',
      build: 'lean',
      clothing: 'black leather',
      accessories: 'silver ring',
      distinguishing: 'scar across the left brow',
    }
    expect(stringToDescriptors(descriptorsToString(original))).toEqual(original)
  })

  it('returns an empty object for blank input', () => {
    expect(stringToDescriptors('')).toEqual({})
    expect(stringToDescriptors('   ')).toEqual({})
  })

  it('drops unlabelled text — the parser pairs on label boundaries only', () => {
    // Free prose before the first label shifts the label/value pairing by one, so the
    // trailing value is lost. Pinned as the current contract: the field is label-delimited,
    // not free text, and the UI only ever feeds it descriptorsToString output.
    expect(stringToDescriptors('A tall man. Hair: red')).toEqual({})
  })
})

describe('hasDescriptors', () => {
  it('is false for null, undefined, empty and whitespace-only values', () => {
    expect(hasDescriptors(null)).toBe(false)
    expect(hasDescriptors(undefined)).toBe(false)
    expect(hasDescriptors({})).toBe(false)
    expect(hasDescriptors({ face: '   ', hair: '' })).toBe(false)
  })

  it('is true as soon as one category has content', () => {
    expect(hasDescriptors({ face: '', hair: 'red' })).toBe(true)
  })
})
