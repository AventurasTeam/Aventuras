import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'

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

describe('deriveCollisions', () => {
  it('pairs a flagged row with its unflagged same-kind namesake, case-insensitively', () => {
    const map = deriveCollisions([
      entity('old', 'Brannoc', { status: 'staged' }),
      entity('new', ' brannoc', { nameCollisionFlag: 1, createdAt: 2 }),
    ])
    expect([...map.entries()]).toEqual([['new', { otherId: 'old', otherName: 'Brannoc' }]])
  })

  it('ignores same-name rows of another kind and unflagged rows', () => {
    const map = deriveCollisions([
      entity('loc', 'Brannoc', { kind: 'location' }),
      entity('new', 'Brannoc', { nameCollisionFlag: 1 }),
      entity('a', 'Mira'),
      entity('b', 'Mira'),
    ])
    expect(map.size).toBe(0)
  })

  it('with three namesakes every flagged row points at the unflagged one', () => {
    const map = deriveCollisions([
      entity('base', 'Sage', { createdAt: 1 }),
      entity('f1', 'Sage', { nameCollisionFlag: 1, createdAt: 2 }),
      entity('f2', 'Sage', { nameCollisionFlag: 1, createdAt: 3 }),
    ])
    expect(map.get('f1')?.otherId).toBe('base')
    expect(map.get('f2')?.otherId).toBe('base')
  })

  it('finds the unflagged namesake even when it appears after the flagged row', () => {
    const map = deriveCollisions([
      entity('f1', 'Sage', { nameCollisionFlag: 1, createdAt: 2 }),
      entity('base', 'Sage', { createdAt: 1 }),
    ])
    expect(map.get('f1')?.otherId).toBe('base')
  })

  it('falls back to the oldest other flagged namesake when none is unflagged', () => {
    const map = deriveCollisions([
      entity('f1', 'Sage', { nameCollisionFlag: 1, createdAt: 2 }),
      entity('f2', 'Sage', { nameCollisionFlag: 1, createdAt: 3 }),
    ])
    expect(map.get('f1')?.otherId).toBe('f2')
    expect(map.get('f2')?.otherId).toBe('f1')
  })

  it('breaks a createdAt tie in the flagged fallback by id, not input order', () => {
    const map = deriveCollisions([
      entity('ccc', 'Sage', { nameCollisionFlag: 1, createdAt: 3 }),
      entity('bbb', 'Sage', { nameCollisionFlag: 1, createdAt: 2 }),
      entity('aaa', 'Sage', { nameCollisionFlag: 1, createdAt: 2 }),
    ])
    expect(map.get('ccc')?.otherId).toBe('aaa')
  })

  it('prefers the unflagged namesake even when a flagged one is older', () => {
    const map = deriveCollisions([
      entity('f_old', 'Sage', { nameCollisionFlag: 1, createdAt: 1 }),
      entity('f_new', 'Sage', { nameCollisionFlag: 1, createdAt: 2 }),
      entity('base', 'Sage', { createdAt: 3 }),
    ])
    expect(map.get('f_new')?.otherId).toBe('base')
  })

  it('picks the unflagged namesake deterministically regardless of input order', () => {
    const flagged = entity('flagged', 'Sage', { nameCollisionFlag: 1, createdAt: 3 })
    const older = entity('older', 'Sage', { createdAt: 1 })
    const newer = entity('newer', 'Sage', { createdAt: 2 })

    expect(deriveCollisions([flagged, older, newer]).get('flagged')?.otherId).toBe('older')
    expect(deriveCollisions([flagged, newer, older]).get('flagged')?.otherId).toBe('older')
  })
})
