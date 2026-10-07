import { describe, expect, it } from 'vitest'

import { emptyEntityState, type Entity } from '@/lib/db'

import { collisionPairOf, type CollisionPair } from './collision-pair'
import {
  entityKeepActions,
  entityRenameActions,
  RENAME_ISSUE,
  renameIssue,
  type EntityRename,
} from './collision-resolve'

function character(id: string, name: string, flag = 0): Entity {
  return {
    id,
    branchId: 'b1',
    kind: 'character',
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: flag,
    state: emptyEntityState('character'),
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

const clear = (id: string) => ({
  kind: 'updateEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id, patch: { nameCollisionFlag: 0 } },
})

function pairOf(first: Entity, second: Entity): CollisionPair {
  const lookup = collisionPairOf([first, second], [first.id, second.id])
  if ('miss' in lookup) throw new Error(`not a collision pair: ${lookup.miss}`)
  return lookup.pair
}

const A = character('char_a', 'Kael')
const B = character('char_b', 'Kael', 1)

describe('renameIssue', () => {
  it('refuses a blank name on either side', () => {
    expect(renameIssue('character', ['  ', 'Kael'])).toBe(RENAME_ISSUE.emptyName)
    expect(renameIssue('character', ['Kael', ''])).toBe(RENAME_ISSUE.emptyName)
    expect(renameIssue('character', ['', ' '])).toBe(RENAME_ISSUE.emptyName)
  })

  it('refuses names the namesake rule still pairs, a case-only change included', () => {
    expect(renameIssue('character', ['Kael', 'Kael'])).toBe(RENAME_ISSUE.stillColliding)
    expect(renameIssue('character', ['Kael', ' KAEL '])).toBe(RENAME_ISSUE.stillColliding)
  })

  it('accepts names that stop colliding', () => {
    expect(renameIssue('character', ['Kael', 'Kael the guard'])).toBeNull()
  })

  it('counts interior spacing as a difference, unlike spaces at either end', () => {
    expect(renameIssue('character', ['Kael the', 'Kael  the'])).toBeNull()
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
      pair: pairOf(first, second),
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
          { id: 'char_b', name: 'kael' },
        ],
      ),
    ).toStrictEqual({ issue: RENAME_ISSUE.stillColliding })
  })

  it('names each row by its id, and keeps the name of a row with no entry', () => {
    const renamedB = {
      actions: [
        {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: {
            branchId: 'b1',
            id: 'char_b',
            patch: { name: 'Kael the guard', nameCollisionFlag: 0 },
          },
        },
      ],
    }
    expect(
      plan(
        [A, B],
        [
          { id: 'char_b', name: 'Kael the guard' },
          { id: 'char_a', name: 'Kael' },
        ],
      ),
    ).toStrictEqual(renamedB)
    expect(plan([A, B], [{ id: 'char_b', name: 'Kael the guard' }])).toStrictEqual(renamedB)
  })

  it('renames the flagged row and clears its flag in one update', () => {
    expect(rename([A, B], ['Kael', ' Kael the guard '])).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          id: 'char_b',
          patch: { name: 'Kael the guard', nameCollisionFlag: 0 },
        },
      },
    ])
  })

  it('renames the other row and clears the flagged one in a second update', () => {
    expect(rename([A, B], ['Kael the elder', 'Kael'])).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_a', patch: { name: 'Kael the elder' } },
      },
      clear('char_b'),
    ])
  })

  it('leaves a row whose stored name only differs by surrounding space unrenamed', () => {
    const spaced = character('char_a', ' Kael ')
    expect(rename([spaced, B], [' Kael ', 'Kael the guard'])).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          id: 'char_b',
          patch: { name: 'Kael the guard', nameCollisionFlag: 0 },
        },
      },
    ])
  })

  it('clears the flagged row of the pair even where another namesake keeps it paired', () => {
    const elder = character('char_x', 'Kael')
    expect(rename([A, B], ['Kael the elder', 'Kael'], [elder])).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_a', patch: { name: 'Kael the elder' } },
      },
      clear('char_b'),
    ])
  })

  it('clears both rows when both are flagged', () => {
    const flaggedA = character('char_a', 'Kael', 1)
    expect(rename([flaggedA, B], ['Kael the elder', 'Kael'])).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          id: 'char_a',
          patch: { name: 'Kael the elder', nameCollisionFlag: 0 },
        },
      },
      clear('char_b'),
    ])
  })

  it('clears a third flagged row the rename leaves without a namesake', () => {
    const third = character('char_c', 'Kael', 1)
    expect(rename([A, B], ['Kael the elder', 'Kael the guard'], [third])).toStrictEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'char_a', patch: { name: 'Kael the elder' } },
      },
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          id: 'char_b',
          patch: { name: 'Kael the guard', nameCollisionFlag: 0 },
        },
      },
      clear('char_c'),
    ])
  })

  it('leaves a third flagged row that keeps a namesake alone', () => {
    const third = character('char_c', 'Kael', 1)
    expect(rename([A, B], ['Kael', 'Kael the guard'], [third]).map((a) => a.payload)).toStrictEqual(
      [{ branchId: 'b1', id: 'char_b', patch: { name: 'Kael the guard', nameCollisionFlag: 0 } }],
    )
  })
})

describe('entityKeepActions', () => {
  it('clears each flagged row of the pair and nothing else', () => {
    const keep = (first: Entity, second: Entity) =>
      entityKeepActions({ branchId: 'b1', pair: pairOf(first, second) })
    expect(keep(A, B)).toStrictEqual([clear('char_b')])
    expect(keep(character('char_a', 'Kael', 1), B)).toStrictEqual([
      clear('char_a'),
      clear('char_b'),
    ])
    expect(keep(A, character('char_b', 'Kael'))).toStrictEqual([])
  })
})
