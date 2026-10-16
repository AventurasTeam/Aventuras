import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import { locationMapView, unhiddenLocationView } from './location-map'
import { itemNamesakes, matchNewLocation as matchAgainst, matchNewPlace } from './new-entity-match'

const place = (
  id: string,
  name: string,
  parent: string | null,
  overrides: Partial<Entity> = {},
): Entity =>
  makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent }, ...overrides })
const thing = (id: string, name: string, overrides: Partial<Entity> = {}): Entity =>
  makeEntity({ id, kind: 'item', name, state: { at_location_id: null }, ...overrides })

const PLAIN = { kind: 'create', flag: null }
const flaggedWith = (partnerId: string) => ({
  kind: 'create',
  flag: { partnerId, reason: 'same-parent' },
})

const MARKET = place('loc_market', 'The Drowned Market', 'loc_hollow')

// The map the prompt showed: built from the same entities around the scene's location.
const matchNewLocation = (
  candidate: { name: string; parentId: string | null },
  entities: readonly Entity[],
  currentLocationId: string | null = null,
) => matchAgainst(candidate, locationMapView(entities, currentLocationId))

describe('matchNewLocation', () => {
  it('reuses an exact sibling across case and spacing', () => {
    expect(
      matchNewLocation({ name: '  the DROWNED market ', parentId: 'loc_hollow' }, [MARKET]),
    ).toEqual({ kind: 'reuse', id: 'loc_market' })
  })

  it('compares a root candidate with root rows, and never across parents', () => {
    const rootMarket = place('loc_root', 'The Drowned Market', null)
    expect(
      matchNewLocation({ name: 'The Drowned Market', parentId: null }, [MARKET, rootMarket]),
    ).toEqual({ kind: 'reuse', id: 'loc_root' })
    expect(
      matchNewLocation({ name: 'The Drowned Market', parentId: 'loc_elsewhere' }, [
        MARKET,
        rootMarket,
      ]),
    ).toEqual(PLAIN)
  })

  it('reuses the oldest of several exact siblings, then the lowest id', () => {
    const entities = [
      place('loc_new', 'Mill', null, { createdAt: 9 }),
      place('loc_z', 'Mill', null, { createdAt: 3 }),
      place('loc_b', 'mill', null, { createdAt: 3 }),
    ]
    expect(matchNewLocation({ name: 'Mill', parentId: null }, entities)).toEqual({
      kind: 'reuse',
      id: 'loc_b',
    })
  })

  it('reuses a disabled or a staged sibling', () => {
    const candidate = { name: 'The Drowned Market', parentId: 'loc_hollow' }
    expect(matchNewLocation(candidate, [{ ...MARKET, injectionMode: 'disabled' }])).toEqual({
      kind: 'reuse',
      id: 'loc_market',
    })
    expect(matchNewLocation(candidate, [{ ...MARKET, status: 'staged' }])).toEqual({
      kind: 'reuse',
      id: 'loc_market',
    })
  })

  // piggyback.md → Matching before creating: a retired place comes back only through review.
  it('never reuses a retired sibling, and flags an exact retired namesake', () => {
    const candidate = { name: 'The Drowned Market', parentId: 'loc_hollow' }
    expect(matchNewLocation(candidate, [{ ...MARKET, status: 'retired' }])).toEqual(
      flaggedWith('loc_market'),
    )
  })

  it('pairs with an exact retired namesake before an older contained name', () => {
    const contained = place('loc_old', 'Market', 'loc_hollow', { createdAt: 1 })
    expect(
      matchNewLocation({ name: 'The Drowned Market', parentId: 'loc_hollow' }, [
        contained,
        { ...MARKET, status: 'retired', createdAt: 9 },
      ]),
    ).toEqual(flaggedWith('loc_market'))
  })

  it('flags a partial name on a retired sibling', () => {
    const retired = place('loc_retired', 'Market', 'loc_hollow', { status: 'retired' })
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', parentId: 'loc_hollow' }, [retired]),
    ).toEqual(flaggedWith('loc_retired'))
  })

  it('flags same-parent a sibling whose name sits inside the candidate', () => {
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', parentId: 'loc_hollow' }, [MARKET]),
    ).toEqual(flaggedWith('loc_market'))
  })

  it('flags a sibling whose keywords hold the candidate name', () => {
    const office = place('loc_office', 'Harbor Office', 'loc_hollow', {
      keywords: ['the customs house'],
    })
    expect(
      matchNewLocation({ name: 'The Customs House', parentId: 'loc_hollow' }, [office]),
    ).toEqual(flaggedWith('loc_office'))
  })

  it('pairs with a contained name before an older keyword hit', () => {
    const office = place('loc_office', 'Harbor Office', 'loc_hollow', {
      keywords: ['the drowned market stalls'],
      createdAt: 1,
    })
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', parentId: 'loc_hollow' }, [
        office,
        { ...MARKET, createdAt: 9 },
      ]),
    ).toEqual(flaggedWith('loc_market'))
  })

  it('pairs with the oldest partial sibling, then the lowest id', () => {
    const entities = [
      place('loc_new', 'Market', 'loc_hollow', { createdAt: 9 }),
      place('loc_z', 'Drowned Market', 'loc_hollow', { createdAt: 2 }),
      place('loc_b', 'Market Stalls', 'loc_hollow', { createdAt: 2 }),
    ]
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', parentId: 'loc_hollow' }, entities),
    ).toEqual(flaggedWith('loc_b'))
  })

  it('ignores a non-location or other-parent row on the partial path', () => {
    const entities = [
      thing('item_stalls', 'Market Stalls'),
      place('loc_other', 'Drowned Market', 'loc_elsewhere'),
    ]
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', parentId: 'loc_hollow' }, entities),
    ).toEqual(PLAIN)
  })

  it('reuses an exact sibling ahead of an older partial one', () => {
    const partial = place('loc_old', 'Market', 'loc_hollow', { createdAt: 1 })
    expect(
      matchNewLocation({ name: 'The Drowned Market', parentId: 'loc_hollow' }, [
        partial,
        { ...MARKET, createdAt: 9 },
      ]),
    ).toEqual({ kind: 'reuse', id: 'loc_market' })
  })

  it('compares only locations', () => {
    const entities = [
      thing('item_lantern', 'Lantern'),
      makeEntity({ id: 'char_lantern', kind: 'character', name: 'Lantern' }),
    ]
    expect(matchNewLocation({ name: 'Lantern', parentId: null }, entities)).toEqual(PLAIN)
  })

  it('creates plain beside unrelated siblings', () => {
    expect(matchNewLocation({ name: 'Lighthouse', parentId: 'loc_hollow' }, [MARKET])).toEqual(
      PLAIN,
    )
  })
})

// piggyback.md → Matching before creating → Reuse: the candidates are what the map would have hung
// under the named parent had it listed every place it left out.
describe('matchNewLocation — by the map the prompt showed', () => {
  const ELDRA = place('loc_eldra', 'Eldra', null)
  const VELLIS = place('loc_vellis', 'Port Vellis', 'loc_eldra', { injectionMode: 'disabled' })
  const VAULT = place('loc_vault', 'The Vault', 'loc_vellis')
  const SANCTUM = place('loc_sanctum', 'Inner Sanctum', 'loc_vault')
  const REGION = [ELDRA, VELLIS, VAULT, SANCTUM]

  it('reuses a place hidden under a left-out parent, by the parent the map showed', () => {
    expect(matchNewLocation({ name: 'The Vault', parentId: 'loc_eldra' }, REGION)).toEqual({
      kind: 'reuse',
      id: 'loc_vault',
    })
    expect(matchNewLocation({ name: 'Inner Sanctum', parentId: 'loc_eldra' }, REGION)).toEqual({
      kind: 'reuse',
      id: 'loc_sanctum',
    })
  })

  it('reuses the left-out place itself under its listed parent', () => {
    expect(matchNewLocation({ name: 'Port Vellis', parentId: 'loc_eldra' }, REGION)).toEqual({
      kind: 'reuse',
      id: 'loc_vellis',
    })
  })

  it('reuses under a left-out parent the create reached, as if it were listed', () => {
    expect(matchNewLocation({ name: 'Inner Sanctum', parentId: 'loc_vault' }, REGION)).toEqual({
      kind: 'reuse',
      id: 'loc_sanctum',
    })
  })

  it('counts the left-out places under a left-out parent too', () => {
    const crypt = place('loc_crypt', 'Crypt', 'loc_sanctum', { createdAt: 9 })
    const cellar = place('loc_cellar', 'Cellar', 'loc_sanctum')
    const deepCrypt = place('loc_deep_crypt', 'Crypt', 'loc_cellar', { createdAt: 1 })
    expect(
      matchNewLocation({ name: 'Crypt', parentId: 'loc_vault' }, [
        ...REGION,
        crypt,
        cellar,
        deepCrypt,
      ]),
    ).toEqual({ kind: 'reuse', id: 'loc_crypt' })
  })

  it('prefers a real child, then the fewest left-out places in between, then the older', () => {
    const near = place('loc_near', 'The Vault', 'loc_eldra', { createdAt: 9 })
    expect(
      matchNewLocation({ name: 'The Vault', parentId: 'loc_eldra' }, [...REGION, near]),
    ).toEqual({ kind: 'reuse', id: 'loc_near' })
    const deeper = place('loc_deep', 'Inner Sanctum', 'loc_sanctum', { createdAt: 1 })
    expect(
      matchNewLocation({ name: 'Inner Sanctum', parentId: 'loc_eldra' }, [...REGION, deeper]),
    ).toEqual({ kind: 'reuse', id: 'loc_sanctum' })
  })

  it('prefers a real root child to a place the map roots through a missing parent', () => {
    const orphan = place('loc_orphan', 'Quay', 'loc_gone', { createdAt: 1 })
    const root = place('loc_root', 'Quay', null, { createdAt: 9 })
    expect(matchNewLocation({ name: 'Quay', parentId: null }, [orphan, root])).toEqual({
      kind: 'reuse',
      id: 'loc_root',
    })
    expect(matchNewLocation({ name: 'Quay', parentId: null }, [orphan])).toEqual({
      kind: 'reuse',
      id: 'loc_orphan',
    })
  })

  it('stops at a listed place: what hangs under it is not under the parent above', () => {
    const listedVellis = { ...VELLIS, injectionMode: 'auto' as const }
    expect(
      matchNewLocation({ name: 'The Vault', parentId: 'loc_eldra' }, [ELDRA, listedVellis, VAULT]),
    ).toEqual(PLAIN)
  })

  it('reads the map around the story: a place listed there is not reached through', () => {
    // The story is in the Vault, so Port Vellis's disabling is suspended for the Vault and
    // the Sanctum: both list under Eldra's map view, the Sanctum under the Vault.
    expect(
      matchNewLocation({ name: 'Inner Sanctum', parentId: 'loc_eldra' }, REGION, 'loc_vault'),
    ).toEqual(PLAIN)
    expect(
      matchNewLocation({ name: 'Inner Sanctum', parentId: 'loc_vault' }, REGION, 'loc_vault'),
    ).toEqual({ kind: 'reuse', id: 'loc_sanctum' })
  })

  it('never reuses a retired place reached through a left-out one, nor flags it there', () => {
    const retiredVault = { ...VAULT, status: 'retired' as const }
    expect(
      matchNewLocation({ name: 'The Vault', parentId: 'loc_eldra' }, [ELDRA, VELLIS, retiredVault]),
    ).toEqual(PLAIN)
  })

  it('flags only real siblings, never a partial name reached through a left-out place', () => {
    expect(matchNewLocation({ name: 'The Vault Door', parentId: 'loc_eldra' }, REGION)).toEqual(
      PLAIN,
    )
  })
})

// classifier.md → Mentioned places: the pass saw every place, so its real children are the set.
describe('matchNewLocation — over an unhidden view, with the candidate keywords', () => {
  const ELDRA = place('loc_eldra', 'Eldra', null)
  const VELLIS = place('loc_vellis', 'Port Vellis', 'loc_eldra', { injectionMode: 'disabled' })
  const VAULT = place('loc_vault', 'The Vault', 'loc_vellis')
  const REGION = [ELDRA, VELLIS, VAULT]
  const unhidden = (
    candidate: { name: string; parentId: string | null; keywords?: readonly string[] },
    entities: readonly Entity[],
  ) => matchAgainst(candidate, unhiddenLocationView(entities))

  it('reuses a disabled real child', () => {
    expect(unhidden({ name: 'Port Vellis', parentId: 'loc_eldra' }, REGION)).toEqual({
      kind: 'reuse',
      id: 'loc_vellis',
    })
  })

  it('never reaches through a disabled place: a grandchild is not a child', () => {
    expect(unhidden({ name: 'The Vault', parentId: 'loc_eldra' }, REGION)).toEqual(PLAIN)
  })

  it("flags a sibling named among the candidate's keywords", () => {
    const mill = place('loc_mill', 'The Old Mill', 'loc_eldra')
    const candidate = { name: 'Varn Mill', parentId: 'loc_eldra' }
    expect(unhidden({ ...candidate, keywords: ['the old mill'] }, [ELDRA, mill])).toEqual(
      flaggedWith('loc_mill'),
    )
    expect(unhidden(candidate, [ELDRA, mill])).toEqual(PLAIN)
  })

  it("pairs with a contained name before an older hit through the candidate's keywords", () => {
    const mill = place('loc_mill', 'The Old Mill', 'loc_eldra', { createdAt: 1 })
    const ford = place('loc_ford', 'Ford', 'loc_eldra', { createdAt: 9 })
    expect(
      unhidden({ name: 'Varn Ford', parentId: 'loc_eldra', keywords: ['the old mill'] }, [
        ELDRA,
        mill,
        ford,
      ]),
    ).toEqual(flaggedWith('loc_ford'))
  })
})

describe('matchNewPlace', () => {
  const settled = [{ name: 'the Gull Inn', parentId: 'loc_town', id: 'loc_new1' }]
  const view = unhiddenLocationView([
    place('loc_town', 'Varn', null),
    place('loc_inn', 'The Gull Inn', 'loc_town'),
  ])

  it('maps a place to an earlier one in the reply with its name and parent, before any row', () => {
    expect(matchNewPlace({ name: 'The Gull Inn', parentId: 'loc_town' }, settled, view)).toEqual({
      kind: 'twin',
      id: 'loc_new1',
    })
  })

  it('matches the existing rows when no earlier place shares its parent', () => {
    expect(matchNewPlace({ name: 'The Gull Inn', parentId: 'loc_town' }, [], view)).toEqual({
      kind: 'reuse',
      id: 'loc_inn',
    })
    expect(matchNewPlace({ name: 'the Gull Inn', parentId: null }, settled, view)).toEqual(PLAIN)
  })
})

describe('itemNamesakes', () => {
  it('returns every exactly named item, any status, oldest first', () => {
    const entities = [
      thing('item_a', 'Sword', { createdAt: 5 }),
      thing('item_b', '  sword ', { createdAt: 2, status: 'retired' }),
      thing('item_c', 'SWORD', { createdAt: 3, status: 'staged' }),
      thing('item_d', 'long sword', { createdAt: 1 }),
      place('loc_sword', 'Sword', null, { createdAt: 1 }),
    ]
    expect(itemNamesakes('sword', entities).map((e) => e.id)).toEqual([
      'item_b',
      'item_c',
      'item_a',
    ])
  })

  it('breaks an age tie by id', () => {
    const entities = [
      thing('item_z', 'key', { createdAt: 4 }),
      thing('item_a', 'Key', { createdAt: 4 }),
    ]
    expect(itemNamesakes('key', entities).map((e) => e.id)).toEqual(['item_a', 'item_z'])
  })

  it('is empty with no exact namesake', () => {
    expect(itemNamesakes('dagger', [thing('item_a', 'Sword')])).toEqual([])
  })
})
