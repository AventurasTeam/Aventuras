import { describe, it, expect } from 'vitest'
import type { Character } from '#lib/types/index.ts'
import { formatExistingCharacters } from './classifierCharacters'

function character(name: string, overrides: Partial<Character> = {}): Character {
  return {
    id: `id-${name}`,
    storyId: 's1',
    name,
    description: null,
    relationship: null,
    traits: [],
    visualDescriptors: {},
    portrait: null,
    status: 'active',
    metadata: null,
    branchId: null,
    ...overrides,
  }
}

describe('formatExistingCharacters', () => {
  it('says so when there are none', () => {
    expect(formatExistingCharacters([])).toBe('(none)')
  })

  it('keeps the name alone on its line, with state indented under it', () => {
    const text = formatExistingCharacters([
      character('Ada (the elder)', { relationship: 'ally', status: 'inactive' }),
    ])
    expect(text).toBe('- Ada (the elder)\n  relationship: ally\n  status: inactive')
  })

  it('shows the appearance of an active character only', () => {
    const look = { hair: 'silver braid', eyes: 'grey' }
    const text = formatExistingCharacters([
      character('Mira', { visualDescriptors: look }),
      character('Tomas', { status: 'inactive', visualDescriptors: look }),
    ])
    expect(text).toBe(
      '- Mira\n  status: active\n  appearance: Hair: silver braid, Eyes: grey\n' +
        '- Tomas\n  status: inactive',
    )
  })
})
