import { describe, expect, it } from 'vitest'

import { emptyEntityState, type Entity } from '@/lib/db'

import { FLAG_CLEAR } from './collision-flags'
import { COLLISION_PAIR_MISS, collisionPairOf, type CollisionPair } from './collision-pair'
import {
  entityKeepActions,
  entityRenameActions,
  RENAME_ISSUE,
  renameIssue,
  type EntityRename,
} from './collision-resolve'

function character(
  id: string,
  name: string,
  partnerId: string | null = null,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    branchId: 'b1',
    kind: 'character',
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: partnerId == null ? 0 : 1,
    nameCollisionPartnerId: partnerId,
    nameCollisionReason: partnerId == null ? null : 'distinct',
    state: emptyEntityState('character'),
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const clear = (id: string) => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch: FLAG_CLEAR },
})

const renamed = (id: string, name: string, cleared = false) => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch: cleared ? { name, ...FLAG_CLEAR } : { name } },
})

function pairOf(first: Entity, second: Entity, others: readonly Entity[] = []): CollisionPair {
  const lookup = collisionPairOf([first, second, ...others], [first.id, second.id])
  if ('miss' in lookup) throw new Error(`not a collision pair: ${lookup.miss}`)
  return lookup.pair
}

const A = character('char_a', 'Kael')
const B = character('char_b', 'Kael', 'char_a')

describe('renameIssue', () => {
  const issue = (names: [string, string], original: [string, string] = ['Kael', 'Kael']) =>
    renameIssue(original, names)

  it('refuses a blank name on either side', () => {
    expect(issue(['  ', 'Jorin'])).toBe(RENAME_ISSUE.emptyName)
    expect(issue(['Jorin', ''])).toBe(RENAME_ISSUE.emptyName)
    expect(issue(['', ' '])).toBe(RENAME_ISSUE.emptyName)
  })

  it('refuses a rename that leaves both trimmed names as they were', () => {
    expect(issue(['Kael', 'Kael'])).toBe(RENAME_ISSUE.unchanged)
    expect(issue([' Kael ', 'Kael  '])).toBe(RENAME_ISSUE.unchanged)
    expect(issue(['Kael', 'Kael'], [' Kael ', 'Kael'])).toBe(RENAME_ISSUE.unchanged)
    expect(issue(['Marta', 'The Innkeeper'], ['Marta', 'The Innkeeper'])).toBe(
      RENAME_ISSUE.unchanged,
    )
  })

  it('refuses names that still match: case aside, interior spacing aside, or one inside the other', () => {
    expect(issue(['Kael', 'KAEL'])).toBe(RENAME_ISSUE.stillColliding)
    expect(issue(['Kael the', 'Kael  the'])).toBe(RENAME_ISSUE.stillColliding)
    expect(issue(['Kael', 'Kael the guard'])).toBe(RENAME_ISSUE.stillColliding)
    expect(issue(['the Innkeeper', 'Innkeeper'], ['Innkeeper', 'Innkeeper'])).toBe(
      RENAME_ISSUE.stillColliding,
    )
  })

  it('accepts names that stop matching, a pair that matched through a keyword included', () => {
    expect(issue(['Kael', 'Jorin'])).toBeNull()
    expect(issue(['Kael', 'Kaelen'])).toBeNull()
    expect(issue(['Marta', 'Innkeeper Grell'], ['Marta', 'The Innkeeper'])).toBeNull()
  })
})

describe('entityRenameActions', () => {
  const plan = (
    [first, second]: readonly [Entity, Entity],
    renames: readonly EntityRename[],
    others: Entity[] = [],
  ) =>
    entityRenameActions({
      branchId: 'b1',
      pair: pairOf(first, second, others),
      renames,
      branchEntities: [first, second, ...others],
    })
  const rename = (
    pair: readonly [Entity, Entity],
    [nameA, nameB]: readonly [string, string],
    others: Entity[] = [],
  ) => {
    const result = plan(
      pair,
      [
        { id: pair[0].id, name: nameA },
        { id: pair[1].id, name: nameB },
      ],
      others,
    )
    if ('issue' in result) throw new Error(`unexpected rename issue: ${result.issue}`)
    return result.actions
  }

  it('returns the rename issue instead of a plan', () => {
    expect(
      plan(
        [A, B],
        [
          { id: 'char_a', name: 'Kael' },
          { id: 'char_b', name: 'Kael the guard' },
        ],
      ),
    ).toStrictEqual({ issue: RENAME_ISSUE.stillColliding })
    expect(plan([A, B], [])).toStrictEqual({ issue: RENAME_ISSUE.unchanged })
  })

  it('names each row by its id, and keeps the name of a row with no entry', () => {
    const renamedB = { actions: [renamed('char_b', 'Jorin', true)] }
    expect(
      plan(
        [A, B],
        [
          { id: 'char_b', name: 'Jorin' },
          { id: 'char_a', name: 'Kael' },
        ],
      ),
    ).toStrictEqual(renamedB)
    expect(plan([A, B], [{ id: 'char_b', name: 'Jorin' }])).toStrictEqual(renamedB)
  })

  it('renames the flagged row and clears its flag in one update', () => {
    expect(rename([A, B], ['Kael', ' Jorin '])).toStrictEqual([renamed('char_b', 'Jorin', true)])
  })

  it('renames the other row and clears the flagged one in a second update', () => {
    expect(rename([A, B], ['Brannoc', 'Kael'])).toStrictEqual([
      renamed('char_a', 'Brannoc'),
      clear('char_b'),
    ])
  })

  it('leaves a row whose stored name only differs by surrounding space unrenamed', () => {
    const spaced = character('char_a', ' Kael ')
    expect(rename([spaced, B], [' Kael ', 'Jorin'])).toStrictEqual([
      renamed('char_b', 'Jorin', true),
    ])
  })

  it('resolves a contained pair once neither name holds the other', () => {
    const stormborn = character('char_b', 'Kael Stormborn', 'char_a')
    expect(rename([A, stormborn], ['Kael', 'Stormborn'])).toStrictEqual([
      renamed('char_b', 'Stormborn', true),
    ])
  })

  it('resolves a keyword pair by a name change, whether or not the keyword still matches', () => {
    const marta = character('char_a', 'Marta', null, { keywords: ['the innkeeper'] })
    const keeper = character('char_b', 'The Innkeeper', 'char_a')
    expect(rename([marta, keeper], ['Marta', 'Innkeeper Grell'])).toStrictEqual([
      renamed('char_b', 'Innkeeper Grell', true),
    ])
    expect(rename([marta, keeper], ['Marta Vell', 'The Innkeeper'])).toStrictEqual([
      renamed('char_a', 'Marta Vell'),
      clear('char_b'),
    ])
  })

  it('clears both rows when their flags name each other', () => {
    const flaggedA = character('char_a', 'Kael', 'char_b')
    expect(rename([flaggedA, B], ['Brannoc', 'Kael'])).toStrictEqual([
      renamed('char_a', 'Brannoc', true),
      clear('char_b'),
    ])
  })

  it('clears a pair row whose partner is gone', () => {
    const dormantA = character('char_a', 'Kael', 'char_gone')
    expect(rename([dormantA, B], ['Kael', 'Jorin'])).toStrictEqual([
      renamed('char_b', 'Jorin', true),
      clear('char_a'),
    ])
  })

  it('keeps a pair row’s flag on a live third row that stays its namesake', () => {
    const third = character('char_c', 'Kael Stormborn')
    const flaggedA = character('char_a', 'Kael', 'char_c')
    expect(rename([flaggedA, B], ['Kael', 'Jorin'], [third])).toStrictEqual([
      renamed('char_b', 'Jorin', true),
    ])
  })

  it('clears a pair row’s flag on a live third row once the rename breaks it', () => {
    const third = character('char_c', 'Kael Stormborn')
    const flaggedA = character('char_a', 'Kael', 'char_c')
    expect(rename([flaggedA, B], ['Brannoc', 'Kael'], [third])).toStrictEqual([
      renamed('char_a', 'Brannoc', true),
      clear('char_b'),
    ])
  })

  it('judges a renamed pair row by its stored keywords too', () => {
    const third = character('char_c', 'Kael Stormborn')
    const flaggedA = character('char_a', 'Kael', 'char_c', { keywords: ['Kael Stormborn'] })
    expect(rename([flaggedA, B], ['Brannoc', 'Kael'], [third])).toStrictEqual([
      renamed('char_a', 'Brannoc'),
      clear('char_b'),
    ])
  })

  it('clears a third row’s flag on a renamed pair row it no longer matches', () => {
    const third = character('char_c', 'Kael', 'char_a')
    expect(rename([A, B], ['Brannoc', 'Kael'], [third])).toStrictEqual([
      renamed('char_a', 'Brannoc'),
      clear('char_b'),
      clear('char_c'),
    ])
  })

  it('leaves a third row’s flag whose pair the rename never touched', () => {
    const third = character('char_c', 'Kael', 'char_a')
    expect(rename([A, B], ['Kael', 'Jorin'], [third])).toStrictEqual([
      renamed('char_b', 'Jorin', true),
    ])
  })
})

describe('entityKeepActions', () => {
  const keep = (first: Entity, second: Entity, others: Entity[] = []) =>
    entityKeepActions({
      branchId: 'b1',
      pair: pairOf(first, second, others),
      branchEntities: [first, second, ...others],
    })

  it('clears the flagged row whose partner is the other row, and nothing else', () => {
    expect(keep(A, B)).toStrictEqual([clear('char_b')])
  })

  it('clears both rows when their flags name each other', () => {
    expect(keep(character('char_a', 'Kael', 'char_b'), B)).toStrictEqual([
      clear('char_a'),
      clear('char_b'),
    ])
  })

  it('clears a pair row whose partner is gone', () => {
    expect(keep(character('char_a', 'Kael', 'char_gone'), B)).toStrictEqual([
      clear('char_a'),
      clear('char_b'),
    ])
  })

  it('keeps a pair row’s flag that names a live third row', () => {
    const third = character('char_c', 'Kael')
    expect(keep(character('char_a', 'Kael', 'char_c'), B, [third])).toStrictEqual([clear('char_b')])
  })

  it('has no pair to keep once neither row is flagged', () => {
    expect(collisionPairOf([A, character('char_b', 'Kael')], ['char_a', 'char_b'])).toStrictEqual({
      miss: COLLISION_PAIR_MISS.notFlagged,
    })
  })
})
