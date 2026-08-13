import { describe, it, expect } from 'vitest'
import {
  editDistance,
  findDuplicateGroups,
  formatDuplicateGroup,
  groupIsSettledBy,
  normalizeName,
  type DuplicateGroup,
} from './names'

const character = (name: string, aliases: string[] = []) => ({ name, aliases, type: 'character' })

describe('normalizeName', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeName("L'Élu")).toBe('elu')
    expect(normalizeName('Kael')).toBe('kael')
    expect(normalizeName('KAEL, the Bold')).toBe('kael the bold')
  })

  it('keeps non-Latin names, which an a-z fold turns into the empty string', () => {
    expect(normalizeName('Иван')).toBe('иван')
    expect(normalizeName('カエレン')).toBe('カエレン')
    // The failure this guards: every non-Latin name folding to '' compares equal to every
    // other one, so two unrelated characters read as duplicates.
    expect(normalizeName('Иван')).not.toBe(normalizeName('Пётр'))
  })

  it('keeps a nobiliary particle, which is part of the surname', () => {
    // "de"/"du"/"di" are not articles. Folded away, "De Luca" *is* "Luca" — and the same
    // normalization once powered `create_entry`'s hard refusal, which then rejected a
    // legitimate entry. The pair is still a candidate, which is the right answer here: it
    // is a question for the agent, not a verdict.
    expect(normalizeName('De Luca')).toBe('de luca')
    expect(findDuplicateGroups([character('De Luca'), character('Luca')])[0].reason).toBe(
      'contained',
    )
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

  it('pairs a short name that is a whole word of a longer one', () => {
    // Short, but not substring noise: "Ren" is a whole token of "Ren Wald". Whether the
    // two are one subject is the question the worklist exists to ask.
    expect(findDuplicateGroups([character('Ren'), character('Ren Wald')])[0].reason).toBe(
      'contained',
    )
  })

  it('does not pair a name that is merely a substring of another', () => {
    // The substring-noise case the token comparison rules out by shape: "Ren" is inside
    // "Renwald" but is not a word of it.
    expect(findDuplicateGroups([character('Ren'), character('Renwald')])).toEqual([])
  })

  it('compares aliases the same way it compares names', () => {
    // Only the primary names used to be compared past the exact-key check, so an alias
    // that had drifted or grown a title was invisible.
    expect(
      findDuplicateGroups([character('Kaelen'), character('Aldric', ['Kaelan the Bold'])])[0]
        .reason,
    ).toBe('contained')

    expect(
      findDuplicateGroups([character('Kaelen'), character('Aldric', ['Kaelan'])])[0].reason,
    ).toBe('similar')
  })

  it('allows a contained token to have drifted too', () => {
    expect(findDuplicateGroups([character('Kaelen'), character('Kaelan the Bold')])[0].reason).toBe(
      'contained',
    )
  })

  it('spends each token of the longer name once', () => {
    // Both tokens of "Maria Marie" reach for the one "Maria" over there — the first
    // exactly, the second by drift. Letting them share it makes containment mean nothing.
    expect(findDuplicateGroups([character('Maria Marie'), character('Maria de Luna')])).toEqual([])
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

describe('formatDuplicateGroup', () => {
  const group: DuplicateGroup = {
    indices: [3, 7, 9],
    names: ['Kaelen', 'Kaelan', 'Kaelen the Bold'],
    reason: 'similar',
  }

  it('drops the members a merge or a delete already took', () => {
    expect(formatDuplicateGroup(group, new Set([7]))).toBe(
      '[3] Kaelen | [9] Kaelen the Bold — near-identical spelling',
    )
  })
})

describe('groupIsSettledBy', () => {
  const group: DuplicateGroup = {
    indices: [3, 7, 9, 11],
    names: ['Kaelen', 'Kaelan', 'Kaelen the Bold', 'Kaelin'],
    reason: 'similar',
  }

  it('refuses a partial answer, which would dismiss neighbouring groups untouched', () => {
    expect(groupIsSettledBy(group, new Set([3, 7]), new Set())).toBe(false)
  })

  it('settles on the full membership', () => {
    expect(groupIsSettledBy(group, new Set([3, 7, 9, 11]), new Set())).toBe(true)
  })

  it('settles on what is left once a merge has consumed the rest', () => {
    // The listing hides 3 and 7, so those are the only indices the agent can name back.
    // Demanding them anyway left the group impossible to close for the rest of the run.
    expect(groupIsSettledBy(group, new Set([9, 11]), new Set([3, 7]))).toBe(true)
  })
})
