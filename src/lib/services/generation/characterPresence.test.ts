import { describe, it, expect } from 'vitest'
import type { Character } from '$lib/types'
import { resolveCharacterPresence } from './characterPresence'

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

const base = {
  newNames: [],
  explicitStatusNames: [],
}

describe('resolveCharacterPresence', () => {
  it('marks an active character absent from the list as away', () => {
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Morvana'), character('Zella')],
      presentNames: ['Morvana'],
    })

    expect(changes).toEqual([{ id: 'id-Zella', name: 'Zella', from: 'active', to: 'inactive' }])
  })

  it('brings a character who returns back into the scene', () => {
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Zella', { status: 'inactive' })],
      presentNames: ['Zella'],
    })

    expect(changes).toEqual([{ id: 'id-Zella', name: 'Zella', from: 'inactive', to: 'active' }])
  })

  it('reports nothing for a character already in the right state', () => {
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Morvana'), character('Zella', { status: 'inactive' })],
      presentNames: ['Morvana'],
    })

    expect(changes).toEqual([])
  })

  it('treats an empty list as no signal, not as an empty room', () => {
    // The schema defaults the field to `[]`, so a model that skipped it is indistinguishable
    // from one reporting nobody. Acting on it would empty the cast in a single turn.
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Morvana'), character('Zella')],
      presentNames: [],
    })

    expect(changes).toEqual([])
  })

  it('changes nothing when the classification errored', () => {
    // A salvaged response is missing whatever the model did not finish writing; absence
    // from the list says nothing about the scene.
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Morvana'), character('Zella')],
      presentNames: ['Morvana'],
      hadError: true,
    })

    expect(changes).toEqual([])
  })

  it('never touches the protagonist', () => {
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Pento', { relationship: 'self' })],
      presentNames: ['Morvana'],
    })

    expect(changes).toEqual([])
  })

  it('never resurrects or re-kills the dead', () => {
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Liana', { status: 'deceased' })],
      presentNames: ['Liana'],
    })

    expect(changes).toEqual([])
  })

  it('yields to an explicit status update', () => {
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Scrim')],
      presentNames: ['Morvana'],
      explicitStatusNames: ['Scrim'],
    })

    expect(changes).toEqual([])
  })

  it('skips the reconciliation on an empty list, whatever this turn created', () => {
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Tarris')],
      presentNames: [],
      newNames: ['Tarris'],
    })

    // Still no signal: presentNames is empty, so the whole reconciliation is skipped.
    expect(changes).toEqual([])
  })

  it('keeps a new character active when the list carries a signal', () => {
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character('Tarris'), character('Zella')],
      presentNames: ['Morvana'],
      newNames: ['Tarris'],
    })

    expect(changes).toEqual([{ id: 'id-Zella', name: 'Zella', from: 'active', to: 'inactive' }])
  })

  it('matches names through accents and punctuation, not through substrings', () => {
    // `sameEntityName` folds "Vor'koth"/"Vorkoth"; it does not fold "Kaelen" into
    // "Baron Kaelen", which would keep the wrong character in the scene.
    const changes = resolveCharacterPresence({
      ...base,
      characters: [character("Vor'koth"), character('Baron Kaelen')],
      presentNames: ['Vorkoth', 'Kaelen'],
    })

    expect(changes).toEqual([
      { id: 'id-Baron Kaelen', name: 'Baron Kaelen', from: 'active', to: 'inactive' },
    ])
  })
})
