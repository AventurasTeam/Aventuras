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
  it('pairs a flagged row with its stored partner, not a namesake picked by name', () => {
    const map = deriveCollisions([
      entity('older', 'Sage', { createdAt: 1 }),
      entity('newer', 'Sage', { createdAt: 2 }),
      entity('flagged', 'Sage', flaggedWith('newer', 3)),
    ])
    expect([...map.entries()]).toEqual([['flagged', { otherId: 'newer', otherName: 'Sage' }]])
  })

  it('pairs a partial namesake with its stored partner', () => {
    const map = deriveCollisions([
      entity('stormborn', 'Kael Stormborn'),
      entity('kael', 'Kael', flaggedWith('stormborn', 2)),
    ])
    expect([...map.entries()]).toEqual([
      ['kael', { otherId: 'stormborn', otherName: 'Kael Stormborn' }],
    ])
  })

  it('still pairs a flag whose partner is no longer its namesake', () => {
    const map = deriveCollisions([
      entity('mira', 'Mira'),
      entity('kael', 'Kael', flaggedWith('mira', 2)),
    ])
    expect(map.get('kael')).toEqual({ otherId: 'mira', otherName: 'Mira' })
  })

  it.each([
    ['the branch no longer has its partner', 'gone'],
    ['its partner is a row of another kind', 'loc'],
    ['it names itself', 'new'],
  ])('leaves a flag dormant when %s, though a same-name row exists', (_, partnerId) => {
    const map = deriveCollisions([
      entity('loc', 'Brannoc', { kind: 'location' }),
      entity('old', 'Brannoc'),
      entity('new', 'Brannoc', flaggedWith(partnerId, 2)),
    ])
    expect(map.size).toBe(0)
  })

  it('with 3+ namesakes, each flagged row pairs with its own partner', () => {
    const map = deriveCollisions([
      entity('base', 'Sage', { createdAt: 1 }),
      entity('f1', 'Sage', flaggedWith('base', 2)),
      entity('f2', 'Sage', flaggedWith('f1', 3)),
    ])
    expect(map.get('f1')).toEqual({ otherId: 'base', otherName: 'Sage' })
    expect(map.get('f2')).toEqual({ otherId: 'f1', otherName: 'Sage' })
  })

  it('after a keep on one pair of three namesakes, the other flagged row keeps its strip', () => {
    const base = entity('base', 'Sage', { createdAt: 1 })
    const first = entity('f1', 'Sage', flaggedWith('base', 2))
    const second = entity('f2', 'Sage', flaggedWith('base', 3))
    const branch = [base, first, second]
    expect(deriveCollisions(branch).get('f1')?.otherId).toBe('base')

    const lookup = collisionPairOf(branch, ['base', 'f1'])
    if ('miss' in lookup) throw new Error(`not a collision pair: ${lookup.miss}`)
    const kept = entityKeepActions({ branchId: 'br_1', pair: lookup.pair, branchEntities: branch })
    const after = deriveCollisions(withFlagsCleared(branch, kept))

    expect(after.has('f1')).toBe(false)
    expect(after.get('f2')).toEqual({ otherId: 'base', otherName: 'Sage' })
  })
})
