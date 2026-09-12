import { describe, expect, it } from 'vitest'

import {
  emptyEntityState,
  VISUAL_CATEGORIES,
  type CharacterState,
  type LocationState,
} from '@/lib/db'

import { makeEntity } from './__tests__/fixtures'
import {
  compareEntities,
  entitySearchScope,
  groupEntitiesByTier,
  matchesEntitySearch,
  queryEntities,
} from './entity-list'

const NONE = { leadId: null, inScene: new Set<string>() }

describe('matchesEntitySearch', () => {
  it('matches a term that appears only in a character state field', () => {
    const kael = makeEntity({
      id: 'char_1',
      kind: 'character',
      name: 'Kael',
      state: { ...emptyEntityState('character'), visual: { hair: 'copper' } },
    })
    expect(matchesEntitySearch(kael, 'copper')).toBe(true)
  })

  it('does not match the same term on a location (per-kind scope)', () => {
    const inn = makeEntity({
      id: 'loc_1',
      kind: 'location',
      name: 'Inn',
      state: {
        ...emptyEntityState('location'),
        condition: 'intact',
        // register.ts stores raw JSON with no schema stripping, so a stray key can
        // exist on a row; proves scope is kind-scoped, not key-presence-scoped.
        visual: { hair: 'copper' },
      } as LocationState,
    })
    expect(matchesEntitySearch(inn, 'copper')).toBe(false)
    expect(matchesEntitySearch(inn, 'intact')).toBe(true)
  })

  it('matches an element of an array state field', () => {
    const kael = makeEntity({
      id: 'char_1',
      kind: 'character',
      name: 'Kael',
      state: { ...emptyEntityState('character'), traits: ['resourceful', 'wary'] },
    })
    expect(matchesEntitySearch(kael, 'wary')).toBe(true)
  })

  it('never matches JSON syntax or FK references', () => {
    const kael = makeEntity({
      id: 'char_1',
      kind: 'character',
      name: 'Kael',
      state: {
        ...emptyEntityState('character'),
        traits: ['wary'],
        current_location_id: 'loc_secret',
      },
    })
    expect(matchesEntitySearch(kael, '"')).toBe(false)
    expect(matchesEntitySearch(kael, '[')).toBe(false)
    expect(matchesEntitySearch(kael, 'loc_secret')).toBe(false)
  })

  it('matches name, description, tags and retired_reason case-insensitively', () => {
    const row = makeEntity({
      id: 'char_1',
      kind: 'character',
      name: 'Mira',
      description: 'A market fixer',
      tags: ['Ally'],
      status: 'retired',
      retiredReason: 'left the city',
    })
    expect(matchesEntitySearch(row, 'MIRA')).toBe(true)
    expect(matchesEntitySearch(row, 'fixer')).toBe(true)
    expect(matchesEntitySearch(row, 'ally')).toBe(true)
    expect(matchesEntitySearch(row, 'left the')).toBe(true)
    expect(matchesEntitySearch(row, '')).toBe(true)
  })

  it('does not match a term absent from name, description, tags, retired_reason and state', () => {
    const kael = makeEntity({
      id: 'char_1',
      kind: 'character',
      name: 'Kael',
      description: 'A wary scout',
      tags: ['ally'],
      state: { ...emptyEntityState('character'), traits: ['wary'], visual: { hair: 'copper' } },
    })
    expect(matchesEntitySearch(kael, 'syndicate')).toBe(false)
  })

  it('matches an element of character drives', () => {
    const kael = makeEntity({
      id: 'char_1',
      kind: 'character',
      name: 'Kael',
      state: { ...emptyEntityState('character'), drives: ['loyalty'] },
    })
    expect(matchesEntitySearch(kael, 'loyalty')).toBe(true)
  })

  it('matches character voice', () => {
    const kael = makeEntity({
      id: 'char_1',
      kind: 'character',
      name: 'Kael',
      state: { ...emptyEntityState('character'), voice: 'gravelly baritone' },
    })
    expect(matchesEntitySearch(kael, 'gravelly')).toBe(true)
  })

  it.each(VISUAL_CATEGORIES)('matches visual.%s', (field) => {
    const visual: CharacterState['visual'] = {}
    visual[field] = 'distinctive-value'
    const kael = makeEntity({
      id: 'char_1',
      kind: 'character',
      name: 'Kael',
      state: { ...emptyEntityState('character'), visual },
    })
    expect(matchesEntitySearch(kael, 'distinctive-value')).toBe(true)
  })

  it('matches item condition', () => {
    const blade = makeEntity({
      id: 'item_1',
      kind: 'item',
      name: 'Blade',
      state: { ...emptyEntityState('item'), condition: 'rusted' },
    })
    expect(matchesEntitySearch(blade, 'rusted')).toBe(true)
  })

  it('matches faction standing', () => {
    const guild = makeEntity({
      id: 'faction_1',
      kind: 'faction',
      name: 'Guild',
      state: { ...emptyEntityState('faction'), standing: 'hostile' },
    })
    expect(matchesEntitySearch(guild, 'hostile')).toBe(true)
  })

  it('matches an element of faction agenda', () => {
    const guild = makeEntity({
      id: 'faction_1',
      kind: 'faction',
      name: 'Guild',
      state: { ...emptyEntityState('faction'), agenda: ['seize the docks'] },
    })
    expect(matchesEntitySearch(guild, 'docks')).toBe(true)
  })
})

describe('sort layers', () => {
  const lead = makeEntity({ id: 'char_lead', kind: 'character', name: 'Zed' })
  const activeIn = makeEntity({ id: 'char_in', kind: 'character', name: 'Mira' })
  const activeOut = makeEntity({ id: 'char_out', kind: 'character', name: 'Aria' })
  const staged = makeEntity({
    id: 'char_staged',
    kind: 'character',
    name: 'Bran',
    status: 'staged',
  })
  const stagedB = makeEntity({
    id: 'char_staged_b',
    kind: 'character',
    name: 'Anna',
    status: 'staged',
  })
  const retired = makeEntity({
    id: 'char_ret',
    kind: 'character',
    name: 'Aaron',
    status: 'retired',
  })
  const signals = { leadId: 'char_lead', inScene: new Set(['char_in']) }

  it('orders lead → active in-scene → active off-scene → staged → retired, alphabetical within', () => {
    const rows = [retired, stagedB, activeOut, staged, activeIn, lead]
    const sorted = queryEntities(rows, 'character', { search: '', filter: 'all' }, signals)
    expect(sorted.map((r) => r.id)).toEqual([
      'char_lead',
      'char_in',
      'char_out',
      'char_staged_b',
      'char_staged',
      'char_ret',
    ])
  })

  it('keeps alphabetical order inside a narrowed filter', () => {
    const rows = [staged, stagedB, activeIn]
    const sorted = queryEntities(rows, 'character', { search: '', filter: 'staged' }, signals)
    expect(sorted.map((r) => r.name)).toEqual(['Anna', 'Bran'])
  })

  it('filters in-scene orthogonally to status', () => {
    const rows = [activeIn, activeOut, staged]
    const sorted = queryEntities(rows, 'character', { search: '', filter: 'in-scene' }, signals)
    expect(sorted.map((r) => r.id)).toEqual(['char_in'])
  })

  it('filters to active only, excluding retired', () => {
    const rows = [activeIn, activeOut, staged, retired]
    const sorted = queryEntities(rows, 'character', { search: '', filter: 'active' }, signals)
    expect(sorted.map((r) => r.id)).toEqual(['char_in', 'char_out'])
  })

  it('filters to retired only', () => {
    const rows = [activeIn, staged, retired]
    const sorted = queryEntities(rows, 'character', { search: '', filter: 'retired' }, signals)
    expect(sorted.map((r) => r.id)).toEqual(['char_ret'])
  })

  it('excludes rows of other kinds', () => {
    const loc = makeEntity({ id: 'loc_1', kind: 'location', name: 'Aaa' })
    const sorted = queryEntities(
      [loc, activeIn],
      'character',
      { search: '', filter: 'all' },
      signals,
    )
    expect(sorted.map((r) => r.id)).toEqual(['char_in'])
  })

  it('keeps the lead pinned ahead of active rows even from a lower tier', () => {
    const leadStaged = makeEntity({
      id: 'char_lead',
      kind: 'character',
      name: 'Zed',
      status: 'staged',
    })
    expect(compareEntities(leadStaged, activeIn, signals)).toBeLessThan(0)

    const leadRetired = makeEntity({
      id: 'char_lead',
      kind: 'character',
      name: 'Zed',
      status: 'retired',
    })
    expect(compareEntities(leadRetired, activeIn, signals)).toBeLessThan(0)
  })

  it('scopes in-scene ordering to the Active tier only', () => {
    const alice = makeEntity({
      id: 'char_alice',
      kind: 'character',
      name: 'Alice',
      status: 'staged',
    })
    const zara = makeEntity({
      id: 'char_zara',
      kind: 'character',
      name: 'Zara',
      status: 'staged',
    })
    const zaraInScene = { leadId: null, inScene: new Set(['char_zara']) }
    expect(compareEntities(alice, zara, zaraInScene)).toBeLessThan(0)
  })

  it('breaks a name tie by createdAt under base-sensitivity collation', () => {
    const annaLower = makeEntity({ id: 'a', kind: 'item', name: 'anna', createdAt: 2 })
    const annaUpper = makeEntity({ id: 'b', kind: 'item', name: 'Anna', createdAt: 1 })
    const sorted = [annaLower, annaUpper].sort((x, y) => compareEntities(x, y, NONE))
    expect(sorted.map((r) => r.name)).toEqual(['Anna', 'anna'])
  })

  it('breaks a full tie (same name, same createdAt) by id', () => {
    const higherId = makeEntity({ id: 'b_id', kind: 'item', name: 'Same', createdAt: 5 })
    const lowerId = makeEntity({ id: 'a_id', kind: 'item', name: 'Same', createdAt: 5 })
    expect(compareEntities(higherId, lowerId, NONE)).toBeGreaterThan(0)
    expect(compareEntities(lowerId, higherId, NONE)).toBeLessThan(0)
  })

  it('orders accented names by locale collation, not code-unit order', () => {
    const a = makeEntity({ id: 'a', kind: 'item', name: 'éclat' })
    const b = makeEntity({ id: 'b', kind: 'item', name: 'Ember' })
    expect(compareEntities(a, b, NONE)).toBeLessThan(0)
  })
})

describe('groupEntitiesByTier', () => {
  it('returns non-empty tiers in Active → Staged → Retired order', () => {
    const active = makeEntity({ id: 'a', kind: 'character', name: 'A' })
    const retired = makeEntity({ id: 'r', kind: 'character', name: 'R', status: 'retired' })
    const grouping = groupEntitiesByTier([retired, active], null)
    expect(grouping.pinned).toBeNull()
    expect(grouping.groups.map((g) => g.key)).toEqual(['active', 'retired'])
    expect(grouping.groups[0].rows.map((r) => r.id)).toEqual(['a'])
  })

  it('pins a staged lead above the groups and removes it from Staged', () => {
    const stagedLead = makeEntity({
      id: 'char_lead',
      kind: 'character',
      name: 'Zed',
      status: 'staged',
    })
    const stagedOther = makeEntity({
      id: 'char_other',
      kind: 'character',
      name: 'Anna',
      status: 'staged',
    })
    const grouping = groupEntitiesByTier([stagedOther, stagedLead], 'char_lead')
    expect(grouping.pinned).toEqual(stagedLead)
    expect(grouping.groups).toEqual([{ key: 'staged', rows: [stagedOther] }])
  })

  it('pins a retired lead and drops the now-empty Retired group', () => {
    const retiredLead = makeEntity({
      id: 'char_lead',
      kind: 'character',
      name: 'Zed',
      status: 'retired',
    })
    const grouping = groupEntitiesByTier([retiredLead], 'char_lead')
    expect(grouping.pinned).toEqual(retiredLead)
    expect(grouping.groups).toEqual([])
  })

  it('does not pin an Active lead and keeps input order in Active', () => {
    const activeLead = makeEntity({ id: 'char_lead', kind: 'character', name: 'Zed' })
    const activeOther = makeEntity({ id: 'char_other', kind: 'character', name: 'Anna' })
    const grouping = groupEntitiesByTier([activeLead, activeOther], 'char_lead')
    expect(grouping.pinned).toBeNull()
    expect(grouping.groups).toEqual([{ key: 'active', rows: [activeLead, activeOther] }])
  })

  it('returns pinned null when leadId is null', () => {
    const rows = [makeEntity({ id: 'a', kind: 'character', name: 'A', status: 'retired' })]
    const grouping = groupEntitiesByTier(rows, null)
    expect(grouping.pinned).toBeNull()
    expect(grouping.groups).toEqual([{ key: 'retired', rows }])
  })

  it('returns pinned null and groups unchanged when leadId is not among rows', () => {
    const rows = [makeEntity({ id: 'a', kind: 'character', name: 'A', status: 'retired' })]
    const grouping = groupEntitiesByTier(rows, 'char_missing')
    expect(grouping.pinned).toBeNull()
    expect(grouping.groups).toEqual([{ key: 'retired', rows }])
  })
})

describe('entitySearchScope', () => {
  it('lists identity fields plus the per-kind state fields', () => {
    expect(entitySearchScope('character')).toEqual([
      'name',
      'description',
      'tags',
      'retiredReason',
      'traits',
      'drives',
      'voice',
      'visual',
    ])
    expect(entitySearchScope('faction')).toEqual([
      'name',
      'description',
      'tags',
      'retiredReason',
      'standing',
      'agenda',
    ])
    expect(entitySearchScope('location')).toEqual([
      'name',
      'description',
      'tags',
      'retiredReason',
      'condition',
    ])
    expect(entitySearchScope('item')).toEqual([
      'name',
      'description',
      'tags',
      'retiredReason',
      'condition',
    ])
  })
})
