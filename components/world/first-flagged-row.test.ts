import { describe, expect, it, vi } from 'vitest'

import type { Entity } from '@/lib/db'
import type { EntityFilter, EntityListSignals, ListQuery, WorldCategory } from '@/lib/list-modules'

import { firstFlaggedRow } from './first-flagged-row'

// The row renderer drags in the RN component tree; these tests read only query and grouping.
vi.mock('@/components/entity/entity-row', () => ({ EntityRow: () => null }))

function entity(
  id: string,
  kind: Entity['kind'],
  name: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    branchId: 'br_1',
    kind,
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

const character = (id: string, name: string, overrides: Partial<Entity> = {}) =>
  entity(id, 'character', name, overrides)

const ALL: ListQuery<EntityFilter> = { search: '', filter: 'all' }
const NONE: EntityListSignals = { leadId: null, inScene: new Set() }

function targetId(
  entities: Entity[],
  flaggedIds: string[],
  options: {
    category?: WorldCategory
    view?: ListQuery<EntityFilter>
    signals?: EntityListSignals
  } = {},
): string | undefined {
  return firstFlaggedRow({
    entities,
    flagged: new Set(flaggedIds),
    category: options.category ?? 'character',
    view: options.view ?? ALL,
    signals: options.signals ?? NONE,
  })?.id
}

describe('firstFlaggedRow', () => {
  it('follows list order (name), not insertion order', () => {
    expect(targetId([character('z', 'Zed'), character('a', 'Abe')], ['z', 'a'])).toBe('a')
  })

  it('ranks tier above name: an active row beats a staged one named earlier', () => {
    const entities = [character('s', 'Aaa', { status: 'staged' }), character('act', 'Zzz')]
    expect(targetId(entities, ['s', 'act'])).toBe('act')
  })

  it('ranks in-scene above name within Active', () => {
    const signals = { leadId: null, inScene: new Set(['in']) }
    expect(
      targetId([character('off', 'Abe'), character('in', 'Zed')], ['off', 'in'], { signals }),
    ).toBe('in')
  })

  it('takes a staged lead from the pinned slot above every tier', () => {
    const entities = [character('act', 'Abe'), character('lead', 'Zed', { status: 'staged' })]
    const signals = { leadId: 'lead', inScene: new Set<string>() }
    expect(targetId(entities, ['act', 'lead'], { signals })).toBe('lead')
  })

  it('prefers a flagged row the current chip shows over the All view’s first', () => {
    const entities = [character('act', 'Abe'), character('ret', 'Zed', { status: 'retired' })]
    const view: ListQuery<EntityFilter> = { search: '', filter: 'retired' }
    expect(targetId(entities, ['act', 'ret'], { view })).toBe('ret')
  })

  it('falls back to the All view when the current search hides every flagged row', () => {
    const entities = [character('b', 'Bea'), character('a', 'Abe'), character('x', 'Xul')]
    const view: ListQuery<EntityFilter> = { search: 'xul', filter: 'all' }
    expect(targetId(entities, ['b', 'a'], { view })).toBe('a')
  })

  it('prefers the current kind over one earlier in the dropdown', () => {
    const entities = [entity('c', 'character', 'Abe'), entity('i', 'item', 'Zed')]
    expect(targetId(entities, ['c', 'i'], { category: 'item' })).toBe('i')
  })

  it('walks the other kinds in dropdown order when the current kind has none', () => {
    const entities = [
      entity('f', 'faction', 'Abe'),
      entity('i', 'item', 'Abe'),
      entity('l', 'location', 'Zed'),
      character('c', 'Unflagged'),
    ]
    expect(targetId(entities, ['f', 'i', 'l'])).toBe('l')
  })

  it('from Lore starts at Characters and ignores the lore view', () => {
    const entities = [entity('l', 'location', 'Abe'), character('c', 'Zed', { status: 'retired' })]
    const view: ListQuery<EntityFilter> = { search: 'nothing-matches', filter: 'all' }
    expect(targetId(entities, ['l', 'c'], { category: 'lore', view })).toBe('c')
  })

  it('returns null when nothing is flagged', () => {
    expect(
      firstFlaggedRow({
        entities: [character('a', 'Abe')],
        flagged: new Set(),
        category: 'character',
        view: ALL,
        signals: NONE,
      }),
    ).toBeNull()
  })
})
