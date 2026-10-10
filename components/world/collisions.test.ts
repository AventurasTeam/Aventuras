import { describe, expect, it } from 'vitest'

import type { PipelineAction } from '@/lib/actions'
import type { Entity } from '@/lib/db'
import { collisionPairOf, entityKeepActions } from '@/lib/world'

import { deriveCollisions } from './collisions'

function entity(id: string, name: string, overrides: Partial<Entity> = {}): Entity {
  return {
    id,
    branchId: 'br_1',
    kind: 'character',
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const flaggedWith = (partnerId: string, createdAt?: number): Partial<Entity> => ({
  nameCollisionFlag: 1,
  nameCollisionPartnerId: partnerId,
  nameCollisionReason: 'distinct',
  ...(createdAt == null ? {} : { createdAt }),
})

function withFlagsCleared(rows: readonly Entity[], actions: readonly PipelineAction[]): Entity[] {
  const cleared = new Set(
    actions.flatMap((action) =>
      action.kind === 'updateEntity' && action.payload.patch.nameCollisionFlag === 0
        ? [action.payload.id]
        : [],
    ),
  )
  return rows.map((row) =>
    cleared.has(row.id)
      ? { ...row, nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null }
      : row,
  )
}

describe('deriveCollisions', () => {
  it('after a keep on one pair of three namesakes, the other flagged row keeps its strip', () => {
    const base = entity('base', 'Sage', { createdAt: 1 })
    const first = entity('f1', 'Sage', flaggedWith('base', 2))
    const second = entity('f2', 'Sage', flaggedWith('base', 3))
    expect(deriveCollisions([base, first, second]).get('f1')?.otherId).toBe('base')

    const lookup = collisionPairOf([base, first, second], ['base', 'f1'])
    if ('miss' in lookup) throw new Error(`not a collision pair: ${lookup.miss}`)
    const kept = entityKeepActions({ branchId: 'br_1', pair: lookup.pair })
    const after = deriveCollisions(withFlagsCleared([base, first, second], kept))

    expect(after.has('f1')).toBe(false)
    expect(after.get('f2')).toEqual({ otherId: 'base', otherName: 'Sage' })
  })

  it('pairs a flagged row with its unflagged same-kind namesake, case-insensitively', () => {
    const map = deriveCollisions([
      entity('old', 'Brannoc', { status: 'staged' }),
      entity('new', ' brannoc', flaggedWith('old', 2)),
    ])
    expect([...map.entries()]).toEqual([['new', { otherId: 'old', otherName: 'Brannoc' }]])
  })

  it('pairs namesakes across composed and decomposed spellings', () => {
    const map = deriveCollisions([
      entity('old', 'Zoë'),
      entity('new', 'Zoë', flaggedWith('old', 2)),
    ])
    expect([...map.entries()]).toEqual([['new', { otherId: 'old', otherName: 'Zoë' }]])
  })

  it('ignores same-name rows of another kind and unflagged rows', () => {
    const map = deriveCollisions([
      entity('loc', 'Brannoc', { kind: 'location' }),
      entity('new', 'Brannoc', flaggedWith('gone')),
      entity('a', 'Mira'),
      entity('b', 'Mira'),
    ])
    expect(map.size).toBe(0)
  })

  it('with three namesakes every flagged row points at the unflagged one', () => {
    const map = deriveCollisions([
      entity('base', 'Sage', { createdAt: 1 }),
      entity('f1', 'Sage', flaggedWith('base', 2)),
      entity('f2', 'Sage', flaggedWith('base', 3)),
    ])
    expect(map.get('f1')?.otherId).toBe('base')
    expect(map.get('f2')?.otherId).toBe('base')
  })

  it('finds the unflagged namesake even when it appears after the flagged row', () => {
    const map = deriveCollisions([
      entity('f1', 'Sage', flaggedWith('base', 2)),
      entity('base', 'Sage', { createdAt: 1 }),
    ])
    expect(map.get('f1')?.otherId).toBe('base')
  })

  it('falls back to the oldest other flagged namesake when none is unflagged', () => {
    const map = deriveCollisions([
      entity('f1', 'Sage', flaggedWith('f2', 2)),
      entity('f2', 'Sage', flaggedWith('f1', 3)),
    ])
    expect(map.get('f1')?.otherId).toBe('f2')
    expect(map.get('f2')?.otherId).toBe('f1')
  })

  it('breaks a createdAt tie in the flagged fallback by id, not input order', () => {
    const map = deriveCollisions([
      entity('ccc', 'Sage', flaggedWith('aaa', 3)),
      entity('bbb', 'Sage', flaggedWith('aaa', 2)),
      entity('aaa', 'Sage', flaggedWith('bbb', 2)),
    ])
    expect(map.get('ccc')?.otherId).toBe('aaa')
  })

  it('prefers the unflagged namesake even when a flagged one is older', () => {
    const map = deriveCollisions([
      entity('f_old', 'Sage', flaggedWith('base', 1)),
      entity('f_new', 'Sage', flaggedWith('base', 2)),
      entity('base', 'Sage', { createdAt: 3 }),
    ])
    expect(map.get('f_new')?.otherId).toBe('base')
  })

  it('picks the unflagged namesake deterministically regardless of input order', () => {
    const flagged = entity('flagged', 'Sage', flaggedWith('older', 3))
    const older = entity('older', 'Sage', { createdAt: 1 })
    const newer = entity('newer', 'Sage', { createdAt: 2 })

    expect(deriveCollisions([flagged, older, newer]).get('flagged')?.otherId).toBe('older')
    expect(deriveCollisions([flagged, newer, older]).get('flagged')?.otherId).toBe('older')
  })
})
