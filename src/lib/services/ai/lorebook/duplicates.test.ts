import { describe, it, expect } from 'vitest'
import { editDistance, findDuplicateGroups, normalizeName } from './duplicates'

const character = (name: string, aliases: string[] = []) => ({ name, aliases, type: 'character' })

describe('normalizeName', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeName("L'Élu")).toBe('elu')
    expect(normalizeName('Kael')).toBe('kael')
    expect(normalizeName('KAEL, the Bold')).toBe('kael the bold')
  })

  it('drops a leading article but never the whole name', () => {
    expect(normalizeName('The Citadel')).toBe('citadel')
    expect(normalizeName('Il Prescelto')).toBe('prescelto')
    expect(normalizeName('The')).toBe('the')
  })
})

describe('editDistance', () => {
  it('counts the edits between two names', () => {
    expect(editDistance('kaelen', 'kaelan', 2)).toBe(1)
    expect(editDistance('kaelen', 'kaelen', 2)).toBe(0)
  })

  it('gives up past the cap instead of computing the real distance', () => {
    expect(editDistance('kael', 'mara', 1)).toBe(2)
  })
})

describe('findDuplicateGroups', () => {
  it('groups entries whose names normalize to the same key', () => {
    const groups = findDuplicateGroups([character('The Citadel'), character('citadel')])
    expect(groups).toHaveLength(1)
    expect(groups[0].indices).toEqual([0, 1])
    expect(groups[0].reason).toBe('same-name')
  })

  it('groups an entry with another entry that lists its name as an alias', () => {
    const groups = findDuplicateGroups([character('Kael'), character('Kaelthas', ['Kael'])])
    expect(groups[0].reason).toBe('shared-alias')
  })

  it('groups a name contained in a longer one of the same type', () => {
    const groups = findDuplicateGroups([character('Kaelen'), character('Kaelen the Bold')])
    expect(groups[0].reason).toBe('contained')
  })

  it('groups a spelling drift', () => {
    const groups = findDuplicateGroups([character('Kaelen'), character('Kaelan')])
    expect(groups[0].reason).toBe('similar')
  })

  it('collapses a transitive chain into one group', () => {
    const groups = findDuplicateGroups([
      character('Kaelen'),
      character('Kaelan'),
      character('Kaelen the Bold'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].indices).toEqual([0, 1, 2])
  })

  it('leaves unrelated entries alone', () => {
    expect(findDuplicateGroups([character('Kael'), character('Mara')])).toEqual([])
  })

  it('does not pair two short names that differ by one letter', () => {
    // "Mara"/"Sara" is one edit apart and they are two people. The allowance starts above
    // this length for exactly that reason.
    expect(findDuplicateGroups([character('Mara'), character('Sara')])).toEqual([])
  })

  it('does not pair a short name with every longer one containing it', () => {
    // "Ren" inside "Renwald" is the substring-noise case, and it is below the fuzzy floor.
    expect(findDuplicateGroups([character('Ren'), character('Ren Wald')])).toEqual([])
  })

  it('compares fuzzily only within a type, but exact names across types', () => {
    expect(
      findDuplicateGroups([
        { name: 'Ashford', aliases: [], type: 'character' },
        { name: 'Ashford Keep', aliases: [], type: 'location' },
      ]),
    ).toEqual([])

    const sameName = findDuplicateGroups([
      { name: 'Ashford', aliases: [], type: 'character' },
      { name: 'Ashford', aliases: [], type: 'location' },
    ])
    expect(sameName).toHaveLength(1)
  })

  it('reports the indices of the array it was given, not of the group', () => {
    const groups = findDuplicateGroups([
      character('Mara'),
      character('The Citadel'),
      character('Citadel'),
    ])
    expect(groups[0].indices).toEqual([1, 2])
    expect(groups[0].names).toEqual(['The Citadel', 'Citadel'])
  })
})
