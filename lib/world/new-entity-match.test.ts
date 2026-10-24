import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import { locationMapView, unhiddenLocationView } from './location-map'
import {
  itemNamesakes,
  matchNewLocation as matchAgainst,
  matchNewPlace as matchInReply,
  type SettledNewPlace,
} from './new-entity-match'
import type { PlacedPlacement, PlacePlacement } from './placement'

const place = (
  id: string,
  name: string,
  parent: string | null,
  overrides: Partial<Entity> = {},
): Entity =>
  makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent }, ...overrides })
const thing = (id: string, name: string, overrides: Partial<Entity> = {}): Entity =>
  makeEntity({ id, kind: 'item', name, state: { at_location_id: null }, ...overrides })

const under = (parentId: string) => ({ kind: 'under', parentId }) as const
const TOP = { kind: 'top' } as const
const UNPLACED = { kind: 'unplaced' } as const

const PLAIN = { kind: 'create', flag: null }
const reuse = (id: string) => ({ kind: 'reuse', id, place: false })
// An unplaced row reused by a create under a parent or at the top level: the writer places it.
const reuseAndPlace = (id: string) => ({ kind: 'reuse', id, place: true })
const flaggedWith = (partnerId: string, reason: 'same-parent' | 'unplaced' = 'same-parent') => ({
  kind: 'create',
  flag: { partnerId, reason },
})
// data-model.md → LocationState shape: known to exist, not where.
const unplaced = (id: string, name: string, overrides: Partial<Entity> = {}): Entity =>
  makeEntity({
    id,
    kind: 'location',
    name,
    state: { parent_location_id: null, unplaced: true },
    ...overrides,
  })

const HOLLOW = place('loc_hollow', 'Hollow', null)
const MARKET = place('loc_market', 'The Drowned Market', 'loc_hollow')

// The map the prompt showed; it always holds the Hollow, as a candidate's parent always exists.
const matchNewLocation = (
  candidate: { name: string; placement: PlacePlacement },
  entities: readonly Entity[],
  currentLocationId: string | null = null,
) => matchAgainst(candidate, locationMapView([HOLLOW, ...entities], currentLocationId))

describe('matchNewLocation', () => {
  it('reuses an exact sibling across case and spacing', () => {
    expect(
      matchNewLocation({ name: '  the DROWNED market ', placement: under('loc_hollow') }, [MARKET]),
    ).toEqual(reuse('loc_market'))
  })

  it('compares a root candidate with root rows, and never across parents', () => {
    const rootMarket = place('loc_root', 'The Drowned Market', null)
    expect(
      matchNewLocation({ name: 'The Drowned Market', placement: TOP }, [MARKET, rootMarket]),
    ).toEqual(reuse('loc_root'))
    expect(
      matchNewLocation({ name: 'The Drowned Market', placement: under('loc_elsewhere') }, [
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
    expect(matchNewLocation({ name: 'Mill', placement: TOP }, entities)).toEqual(reuse('loc_b'))
  })

  it('reuses a disabled or a staged sibling', () => {
    const candidate = { name: 'The Drowned Market', placement: under('loc_hollow') }
    expect(matchNewLocation(candidate, [{ ...MARKET, injectionMode: 'disabled' }])).toEqual(
      reuse('loc_market'),
    )
    expect(matchNewLocation(candidate, [{ ...MARKET, status: 'staged' }])).toEqual(
      reuse('loc_market'),
    )
  })

  // piggyback.md → Matching before creating: a retired place comes back only through review.
  it('never reuses a retired sibling, and flags an exact retired namesake', () => {
    const candidate = { name: 'The Drowned Market', placement: under('loc_hollow') }
    expect(matchNewLocation(candidate, [{ ...MARKET, status: 'retired' }])).toEqual(
      flaggedWith('loc_market'),
    )
  })

  it('pairs with an exact retired namesake before an older contained name', () => {
    const contained = place('loc_old', 'Market', 'loc_hollow', { createdAt: 1 })
    expect(
      matchNewLocation({ name: 'The Drowned Market', placement: under('loc_hollow') }, [
        contained,
        { ...MARKET, status: 'retired', createdAt: 9 },
      ]),
    ).toEqual(flaggedWith('loc_market'))
  })

  it('flags a partial name on a retired sibling', () => {
    const retired = place('loc_retired', 'Market', 'loc_hollow', { status: 'retired' })
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', placement: under('loc_hollow') }, [
        retired,
      ]),
    ).toEqual(flaggedWith('loc_retired'))
  })

  it('flags same-parent a sibling whose name sits inside the candidate', () => {
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', placement: under('loc_hollow') }, [
        MARKET,
      ]),
    ).toEqual(flaggedWith('loc_market'))
  })

  it('flags a sibling whose keywords hold the candidate name', () => {
    const office = place('loc_office', 'Harbor Office', 'loc_hollow', {
      keywords: ['the customs house'],
    })
    expect(
      matchNewLocation({ name: 'The Customs House', placement: under('loc_hollow') }, [office]),
    ).toEqual(flaggedWith('loc_office'))
  })

  it('pairs with a contained name before an older keyword hit', () => {
    const office = place('loc_office', 'Harbor Office', 'loc_hollow', {
      keywords: ['the drowned market stalls'],
      createdAt: 1,
    })
    expect(
      matchNewLocation({ name: 'The Drowned Market Stalls', placement: under('loc_hollow') }, [
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
      matchNewLocation(
        { name: 'The Drowned Market Stalls', placement: under('loc_hollow') },
        entities,
      ),
    ).toEqual(flaggedWith('loc_b'))
  })

  it('ignores a non-location or other-parent row on the partial path', () => {
    const entities = [
      thing('item_stalls', 'Market Stalls'),
      place('loc_other', 'Drowned Market', 'loc_elsewhere'),
    ]
    expect(
      matchNewLocation(
        { name: 'The Drowned Market Stalls', placement: under('loc_hollow') },
        entities,
      ),
    ).toEqual(PLAIN)
  })

  it('reuses an exact sibling ahead of an older partial one', () => {
    const partial = place('loc_old', 'Market', 'loc_hollow', { createdAt: 1 })
    expect(
      matchNewLocation({ name: 'The Drowned Market', placement: under('loc_hollow') }, [
        partial,
        { ...MARKET, createdAt: 9 },
      ]),
    ).toEqual(reuse('loc_market'))
  })

  it('compares only locations', () => {
    const entities = [
      thing('item_lantern', 'Lantern'),
      makeEntity({ id: 'char_lantern', kind: 'character', name: 'Lantern' }),
    ]
    expect(matchNewLocation({ name: 'Lantern', placement: TOP }, entities)).toEqual(PLAIN)
  })

  it('creates plain beside unrelated siblings', () => {
    expect(
      matchNewLocation({ name: 'Lighthouse', placement: under('loc_hollow') }, [MARKET]),
    ).toEqual(PLAIN)
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
    expect(matchNewLocation({ name: 'The Vault', placement: under('loc_eldra') }, REGION)).toEqual(
      reuse('loc_vault'),
    )
    expect(
      matchNewLocation({ name: 'Inner Sanctum', placement: under('loc_eldra') }, REGION),
    ).toEqual(reuse('loc_sanctum'))
  })

  it('reuses the left-out place itself under its listed parent', () => {
    expect(
      matchNewLocation({ name: 'Port Vellis', placement: under('loc_eldra') }, REGION),
    ).toEqual(reuse('loc_vellis'))
  })

  it('reuses under a left-out parent the create reached, as if it were listed', () => {
    expect(
      matchNewLocation({ name: 'Inner Sanctum', placement: under('loc_vault') }, REGION),
    ).toEqual(reuse('loc_sanctum'))
  })

  it('counts the left-out places under a left-out parent too', () => {
    const crypt = place('loc_crypt', 'Crypt', 'loc_sanctum', { createdAt: 9 })
    const cellar = place('loc_cellar', 'Cellar', 'loc_sanctum')
    const deepCrypt = place('loc_deep_crypt', 'Crypt', 'loc_cellar', { createdAt: 1 })
    expect(
      matchNewLocation({ name: 'Crypt', placement: under('loc_vault') }, [
        ...REGION,
        crypt,
        cellar,
        deepCrypt,
      ]),
    ).toEqual(reuse('loc_crypt'))
  })

  it('prefers a real child, then the fewest left-out places in between, then the older', () => {
    const near = place('loc_near', 'The Vault', 'loc_eldra', { createdAt: 9 })
    expect(
      matchNewLocation({ name: 'The Vault', placement: under('loc_eldra') }, [...REGION, near]),
    ).toEqual(reuse('loc_near'))
    const deeper = place('loc_deep', 'Inner Sanctum', 'loc_sanctum', { createdAt: 1 })
    expect(
      matchNewLocation({ name: 'Inner Sanctum', placement: under('loc_eldra') }, [
        ...REGION,
        deeper,
      ]),
    ).toEqual(reuse('loc_sanctum'))
  })

  // The map lists a stored parent loop flat at the top level, beside the real top-level places.
  it('prefers a real top-level place to an older one on a parent loop the map hangs there', () => {
    const rows = [
      place('loc_a', 'Mill', 'loc_b', { createdAt: 1 }),
      place('loc_b', 'Weir', 'loc_a', { createdAt: 1 }),
      place('loc_real', 'Mill', null, { createdAt: 9 }),
    ]
    expect(locationMapView([HOLLOW, ...rows], null).hiddenBetween('loc_a', null)).toBe(0)
    expect(matchNewLocation({ name: 'Mill', placement: TOP }, rows)).toEqual(reuse('loc_real'))
  })

  // A place whose parent row is gone is unplaced: its container is gone.
  it('prefers a real top-level place to one whose parent row is gone, which it reuses and places', () => {
    const orphan = place('loc_orphan', 'Quay', 'loc_gone', { createdAt: 1 })
    const root = place('loc_root', 'Quay', null, { createdAt: 9 })
    expect(matchNewLocation({ name: 'Quay', placement: TOP }, [orphan, root])).toEqual(
      reuse('loc_root'),
    )
    expect(matchNewLocation({ name: 'Quay', placement: TOP }, [orphan])).toEqual(
      reuseAndPlace('loc_orphan'),
    )
  })

  it('never flags a place whose parent row is gone as a top-level sibling', () => {
    const orphan = place('loc_orphan', 'Quay', 'loc_gone')
    expect(matchNewLocation({ name: 'Quay Street', placement: TOP }, [orphan])).toEqual(PLAIN)
  })

  it('stops at a listed place: what hangs under it is not under the parent above', () => {
    const listedVellis = { ...VELLIS, injectionMode: 'auto' as const }
    expect(
      matchNewLocation({ name: 'The Vault', placement: under('loc_eldra') }, [
        ELDRA,
        listedVellis,
        VAULT,
      ]),
    ).toEqual(PLAIN)
  })

  it('reads the map around the story: a place listed there is not reached through', () => {
    // The story is in the Vault, so Port Vellis's disabling is suspended for the Vault and
    // the Sanctum: both list under Eldra's map view, the Sanctum under the Vault.
    expect(
      matchNewLocation(
        { name: 'Inner Sanctum', placement: under('loc_eldra') },
        REGION,
        'loc_vault',
      ),
    ).toEqual(PLAIN)
    expect(
      matchNewLocation(
        { name: 'Inner Sanctum', placement: under('loc_vault') },
        REGION,
        'loc_vault',
      ),
    ).toEqual(reuse('loc_sanctum'))
  })

  it('never reuses a retired place reached through a left-out one, nor flags it there', () => {
    const retiredVault = { ...VAULT, status: 'retired' as const }
    expect(
      matchNewLocation({ name: 'The Vault', placement: under('loc_eldra') }, [
        ELDRA,
        VELLIS,
        retiredVault,
      ]),
    ).toEqual(PLAIN)
  })

  it('flags only real siblings, never a partial name reached through a left-out place', () => {
    expect(
      matchNewLocation({ name: 'The Vault Door', placement: under('loc_eldra') }, REGION),
    ).toEqual(PLAIN)
  })
})

// classifier.md → Mentioned places: the pass saw every place, so its real children are the set.
describe('matchNewLocation — over an unhidden view, with the candidate keywords', () => {
  const ELDRA = place('loc_eldra', 'Eldra', null)
  const VELLIS = place('loc_vellis', 'Port Vellis', 'loc_eldra', { injectionMode: 'disabled' })
  const VAULT = place('loc_vault', 'The Vault', 'loc_vellis')
  const REGION = [ELDRA, VELLIS, VAULT]
  const unhidden = (
    candidate: { name: string; placement: PlacePlacement; keywords?: readonly string[] },
    entities: readonly Entity[],
  ) => matchAgainst(candidate, unhiddenLocationView(entities))

  it('reuses a disabled real child', () => {
    expect(unhidden({ name: 'Port Vellis', placement: under('loc_eldra') }, REGION)).toEqual(
      reuse('loc_vellis'),
    )
  })

  it('never reaches through a disabled place: a grandchild is not a child', () => {
    expect(unhidden({ name: 'The Vault', placement: under('loc_eldra') }, REGION)).toEqual(PLAIN)
  })

  it('flags no sibling in a place whose parent row is gone, which the tree shows unplaced', () => {
    const orphan = place('loc_orphan', 'Quay', 'loc_gone')
    expect(unhidden({ name: 'Quay Street', placement: TOP }, [orphan])).toEqual(PLAIN)
    expect(
      unhidden({ name: 'Quay Street', placement: under('loc_eldra') }, [ELDRA, orphan]),
    ).toEqual(PLAIN)
  })

  it("flags a sibling named among the candidate's keywords", () => {
    const mill = place('loc_mill', 'The Old Mill', 'loc_eldra')
    const candidate = { name: 'Varn Mill', placement: under('loc_eldra') }
    expect(unhidden({ ...candidate, keywords: ['the old mill'] }, [ELDRA, mill])).toEqual(
      flaggedWith('loc_mill'),
    )
    expect(unhidden(candidate, [ELDRA, mill])).toEqual(PLAIN)
  })

  it("pairs with a contained name before an older hit through the candidate's keywords", () => {
    const mill = place('loc_mill', 'The Old Mill', 'loc_eldra', { createdAt: 1 })
    const ford = place('loc_ford', 'Ford', 'loc_eldra', { createdAt: 9 })
    expect(
      unhidden({ name: 'Varn Ford', placement: under('loc_eldra'), keywords: ['the old mill'] }, [
        ELDRA,
        mill,
        ford,
      ]),
    ).toEqual(flaggedWith('loc_ford'))
  })
})

// data-model.md → LocationState shape: matching takes in unplaced places three ways.
describe('matchNewLocation — the unplaced places', () => {
  const VARN = unplaced('loc_varn', 'Varn')
  const placed = (candidate: { name: string; placement: PlacePlacement }, rows: Entity[]) =>
    matchNewLocation(candidate, rows)

  describe('a new place under a parent or top-level', () => {
    it('reuses an unplaced place of exactly its name, which the writer places there', () => {
      expect(placed({ name: 'varn', placement: under('loc_hollow') }, [VARN])).toEqual(
        reuseAndPlace('loc_varn'),
      )
      expect(placed({ name: 'Varn', placement: TOP }, [VARN])).toEqual(reuseAndPlace('loc_varn'))
    })

    it('reuses what the map hangs there before an unplaced namesake', () => {
      const local = place('loc_local', 'Varn', 'loc_hollow', { createdAt: 9 })
      expect(
        placed({ name: 'Varn', placement: under('loc_hollow') }, [
          { ...VARN, createdAt: 1 },
          local,
        ]),
      ).toEqual(reuse('loc_local'))
    })

    it('reuses the oldest of several unplaced namesakes, then the lowest id', () => {
      const rows = [
        unplaced('loc_new', 'Varn', { createdAt: 9 }),
        unplaced('loc_z', 'Varn', { createdAt: 3 }),
        unplaced('loc_b', 'varn', { createdAt: 3 }),
      ]
      expect(placed({ name: 'Varn', placement: TOP }, rows)).toEqual(reuseAndPlace('loc_b'))
    })

    it('reuses a staged or a disabled unplaced place, which the map leaves out', () => {
      for (const row of [
        { ...VARN, status: 'staged' as const },
        { ...VARN, injectionMode: 'disabled' as const },
      ])
        expect(placed({ name: 'Varn', placement: under('loc_hollow') }, [row])).toEqual(
          reuseAndPlace('loc_varn'),
        )
    })

    it('never reuses a retired unplaced place, nor flags one from another placement', () => {
      expect(
        placed({ name: 'Varn', placement: under('loc_hollow') }, [
          { ...VARN, status: 'retired' as const },
        ]),
      ).toEqual(PLAIN)
    })

    it('never reuses an unplaced place by a partial name, nor flags it', () => {
      expect(placed({ name: 'Varn Docks', placement: under('loc_hollow') }, [VARN])).toEqual(PLAIN)
      expect(placed({ name: 'Varn Docks', placement: TOP }, [VARN])).toEqual(PLAIN)
    })

    // world.md → Surfacing: two top-level places share the top level as a parent.
    it('flags a top-level sibling same-parent, never an unplaced place', () => {
      const quay = place('loc_quay', 'Quay', null)
      expect(placed({ name: 'Quay Street', placement: TOP }, [quay])).toEqual(
        flaggedWith('loc_quay'),
      )
      expect(placed({ name: 'Quay Street', placement: TOP }, [unplaced('loc_q', 'Quay')])).toEqual(
        PLAIN,
      )
    })
  })

  describe('a new unplaced place', () => {
    const EASTGATE = place('loc_east', 'Eastgate', null)
    const MARKET_ELSEWHERE = place('loc_m2', 'The Drowned Market', 'loc_east')

    it('reuses the one place of exactly its name, placed or not, as it stands', () => {
      expect(placed({ name: 'the drowned MARKET', placement: UNPLACED }, [MARKET])).toEqual(
        reuse('loc_market'),
      )
      expect(placed({ name: 'Varn', placement: UNPLACED }, [VARN])).toEqual(reuse('loc_varn'))
    })

    it('reuses one the map leaves out', () => {
      const disabled = { ...MARKET, injectionMode: 'disabled' as const }
      expect(placed({ name: 'The Drowned Market', placement: UNPLACED }, [disabled])).toEqual(
        reuse('loc_market'),
      )
    })

    it('flags several exact namesakes unplaced, an unplaced partner before an older placed one', () => {
      expect(
        placed({ name: 'Varn', placement: UNPLACED }, [
          place('loc_placed', 'Varn', 'loc_hollow', { createdAt: 1 }),
          { ...VARN, createdAt: 9 },
        ]),
      ).toEqual(flaggedWith('loc_varn', 'unplaced'))
    })

    it('pairs with the oldest of several placed namesakes, then the lowest id', () => {
      expect(
        placed({ name: 'The Drowned Market', placement: UNPLACED }, [
          EASTGATE,
          { ...MARKET, id: 'loc_z', createdAt: 3 },
          { ...MARKET_ELSEWHERE, id: 'loc_b', createdAt: 3 },
          { ...MARKET, id: 'loc_a', createdAt: 7 },
        ]),
      ).toEqual(flaggedWith('loc_b', 'unplaced'))
    })

    // A retired place is never reused, so it comes back only through review.
    it('flags an exact retired namesake alone, and reuses a live one beside it', () => {
      const retired = { ...MARKET, status: 'retired' as const }
      expect(placed({ name: 'The Drowned Market', placement: UNPLACED }, [retired])).toEqual(
        flaggedWith('loc_market', 'unplaced'),
      )
      expect(
        placed({ name: 'The Drowned Market', placement: UNPLACED }, [
          EASTGATE,
          retired,
          { ...MARKET_ELSEWHERE, createdAt: 9 },
        ]),
      ).toEqual(reuse('loc_m2'))
    })

    it('flags a partial name, or a keyword hit, against another unplaced place', () => {
      expect(placed({ name: 'Varn Docks', placement: UNPLACED }, [VARN])).toEqual(
        flaggedWith('loc_varn', 'unplaced'),
      )
      const ferry = unplaced('loc_ferry', 'The Ferry', { keywords: ['varn crossing'] })
      expect(placed({ name: 'Varn Crossing', placement: UNPLACED }, [ferry])).toEqual(
        flaggedWith('loc_ferry', 'unplaced'),
      )
    })

    it('flags a partial name on a retired unplaced place', () => {
      expect(
        placed({ name: 'Varn Docks', placement: UNPLACED }, [
          { ...VARN, status: 'retired' as const },
        ]),
      ).toEqual(flaggedWith('loc_varn', 'unplaced'))
    })

    it('never flags a partial name elsewhere on the map', () => {
      expect(placed({ name: 'The Drowned Market Stalls', placement: UNPLACED }, [MARKET])).toEqual(
        PLAIN,
      )
    })

    it('compares only locations', () => {
      expect(
        placed({ name: 'Varn', placement: UNPLACED }, [
          thing('item_varn', 'Varn'),
          makeEntity({ id: 'char_varn', kind: 'character', name: 'Varn' }),
        ]),
      ).toEqual(PLAIN)
    })
  })

  // classifier.md → Mentioned places: the pass's top-level create places the unplaced match.
  it('reuses and places an unplaced namesake over the unhidden view too', () => {
    expect(
      matchAgainst({ name: 'Varn', placement: TOP }, unhiddenLocationView([HOLLOW, VARN])),
    ).toEqual(reuseAndPlace('loc_varn'))
  })
})

// No create of the reply was placed by a takeover unless a case says so.
const matchNewPlace = (
  candidate: { name: string; placement: PlacePlacement },
  settled: readonly SettledNewPlace[],
  view: Parameters<typeof matchInReply>[2],
  placedHere: ReadonlyMap<string, PlacedPlacement> = new Map(),
) => matchInReply(candidate, settled, view, placedHere)

describe('matchNewPlace', () => {
  const settled = [{ name: 'the Gull Inn', placement: under('loc_town'), id: 'loc_new1' }]
  const view = unhiddenLocationView([
    place('loc_town', 'Varn', null),
    place('loc_inn', 'The Gull Inn', 'loc_town'),
  ])
  const twin = (id: string) => ({ kind: 'twin', id, place: false })
  // An earlier create of this reply left unplaced, which the writer places where this one sits.
  const takeOver = (id: string) => ({ kind: 'twin', id, place: true })

  it('maps a place to an earlier one in the reply with its name and parent, before any row', () => {
    expect(
      matchNewPlace({ name: 'The Gull Inn', placement: under('loc_town') }, settled, view),
    ).toEqual(twin('loc_new1'))
  })

  it('matches the existing rows when no earlier place shares its parent', () => {
    expect(matchNewPlace({ name: 'The Gull Inn', placement: under('loc_town') }, [], view)).toEqual(
      reuse('loc_inn'),
    )
    expect(matchNewPlace({ name: 'the Gull Inn', placement: TOP }, settled, view)).toEqual(PLAIN)
  })

  describe('as successive replies would', () => {
    it('maps an unplaced place to an earlier unplaced namesake', () => {
      const earlier = [
        { name: 'Ashfall', placement: UNPLACED, id: 'loc_new1' },
        { name: 'ASHFALL', placement: UNPLACED, id: 'loc_new1' },
      ]
      expect(matchNewPlace({ name: 'ashfall', placement: UNPLACED }, earlier, view)).toEqual(
        twin('loc_new1'),
      )
    })

    it('maps an unplaced place to an earlier namesake placed anywhere', () => {
      expect(
        matchNewPlace(
          { name: 'Ashfall', placement: UNPLACED },
          [{ name: 'Ashfall', placement: under('loc_town'), id: 'loc_new1' }],
          view,
        ),
      ).toEqual(twin('loc_new1'))
      expect(
        matchNewPlace(
          { name: 'Ashfall', placement: UNPLACED },
          [{ name: 'Ashfall', placement: TOP, id: 'loc_new1' }],
          view,
        ),
      ).toEqual(twin('loc_new1'))
    })

    it('takes over an earlier unplaced namesake for a place under a parent or top-level', () => {
      const earlier = [{ name: 'Ashfall', placement: UNPLACED, id: 'loc_new1' }]
      expect(matchNewPlace({ name: 'ashfall', placement: TOP }, earlier, view)).toEqual(
        takeOver('loc_new1'),
      )
      expect(
        matchNewPlace({ name: 'Ashfall', placement: under('loc_town') }, earlier, view),
      ).toEqual(takeOver('loc_new1'))
    })

    // An earlier create is newer than every row, as a later reply's would be.
    it('reuses a row the map hangs there, or an unplaced row, before taking an earlier create over', () => {
      const earlier = [{ name: 'The Gull Inn', placement: UNPLACED, id: 'loc_new1' }]
      expect(
        matchNewPlace({ name: 'The Gull Inn', placement: under('loc_town') }, earlier, view),
      ).toEqual(reuse('loc_inn'))
      const withUnplaced = unhiddenLocationView([unplaced('loc_ash', 'Ashfall')])
      expect(
        matchNewPlace(
          { name: 'Ashfall', placement: TOP },
          [{ name: 'Ashfall', placement: UNPLACED, id: 'loc_new1' }],
          withUnplaced,
        ),
      ).toEqual(reuseAndPlace('loc_ash'))
    })

    it('takes over an earlier unplaced create ahead of flagging a partial sibling', () => {
      expect(
        matchNewPlace(
          { name: 'The Gull', placement: under('loc_town') },
          [{ name: 'The Gull', placement: UNPLACED, id: 'loc_new1' }],
          view,
        ),
      ).toEqual(takeOver('loc_new1'))
    })

    it('never takes over a row an earlier unplaced place reused', () => {
      const reusedRow = [{ name: 'The Gull Inn', placement: UNPLACED, id: 'loc_inn' }]
      expect(matchNewPlace({ name: 'The Gull Inn', placement: TOP }, reusedRow, view)).toEqual(
        PLAIN,
      )
    })

    it('keeps a place apart from an earlier namesake placed elsewhere', () => {
      expect(
        matchNewPlace(
          { name: 'Ashfall', placement: TOP },
          [{ name: 'Ashfall', placement: under('loc_town'), id: 'loc_new1' }],
          view,
        ),
      ).toEqual(PLAIN)
    })

    it('flags several namesakes unplaced: an unplaced partner first, then a row before a create', () => {
      const placedCreate = { name: 'The Gull Inn', placement: TOP, id: 'loc_new1' }
      expect(
        matchNewPlace({ name: 'The Gull Inn', placement: UNPLACED }, [placedCreate], view),
      ).toEqual(flaggedWith('loc_inn', 'unplaced'))
      const withUnplaced = unhiddenLocationView([
        place('loc_town', 'Varn', null),
        place('loc_inn', 'The Gull Inn', 'loc_town', { createdAt: 1 }),
        unplaced('loc_gull', 'The Gull Inn', { createdAt: 9 }),
      ])
      expect(
        matchNewPlace({ name: 'The Gull Inn', placement: UNPLACED }, [placedCreate], withUnplaced),
      ).toEqual(flaggedWith('loc_gull', 'unplaced'))
      const twoCreates = [
        { name: 'Ashfall', placement: TOP, id: 'loc_new1' },
        { name: 'Ashfall', placement: under('loc_town'), id: 'loc_new2' },
      ]
      expect(matchNewPlace({ name: 'Ashfall', placement: UNPLACED }, twoCreates, view)).toEqual(
        flaggedWith('loc_new1', 'unplaced'),
      )
    })

    // piggyback.md → Matching before creating: the twin rule comes before every other match.
    it('maps an unplaced place to an earlier unplaced twin, even beside stored namesakes', () => {
      const flaggedCreate = { name: 'The Gull Inn', placement: UNPLACED, id: 'loc_new2' }
      expect(
        matchNewPlace(
          { name: 'the gull inn', placement: UNPLACED },
          [{ name: 'The Gull Inn', placement: TOP, id: 'loc_new1' }, flaggedCreate],
          view,
        ),
      ).toEqual(twin('loc_new2'))
    })

    describe('an earlier create a takeover placed', () => {
      const earlier = [
        { name: 'Ashfall', placement: UNPLACED, id: 'loc_new1' },
        { name: 'Ashfall', placement: under('loc_town'), id: 'loc_new1' },
      ]
      const placedHere = new Map([['loc_new1', under('loc_town')]])

      it('still maps an unplaced place to it, as the twin it declared', () => {
        expect(
          matchNewPlace({ name: 'Ashfall', placement: UNPLACED }, earlier, view, placedHere),
        ).toEqual(twin('loc_new1'))
      })

      it('never takes over one a takeover made top-level', () => {
        expect(
          matchNewPlace(
            { name: 'Ashfall', placement: under('loc_town') },
            [
              { name: 'Ashfall', placement: UNPLACED, id: 'loc_new1' },
              { name: 'Ashfall', placement: TOP, id: 'loc_new1' },
            ],
            view,
            new Map([['loc_new1', TOP]]),
          ),
        ).toEqual(PLAIN)
      })

      it('never takes it over again: a namesake under another parent is its own row', () => {
        expect(
          matchNewPlace({ name: 'Ashfall', placement: TOP }, earlier, view, placedHere),
        ).toEqual(PLAIN)
      })
    })

    describe("a partial name or a keyword hit on the reply's earlier creates", () => {
      const docks = { name: 'Docks', placement: under('loc_town'), id: 'loc_new1' }

      it('flags a placed place against an earlier create beside it, same-parent', () => {
        expect(
          matchNewPlace({ name: 'Old Docks', placement: under('loc_town') }, [docks], view),
        ).toEqual(flaggedWith('loc_new1'))
        expect(
          matchNewPlace(
            { name: 'Old Docks', placement: TOP },
            [{ ...docks, placement: TOP }],
            view,
          ),
        ).toEqual(flaggedWith('loc_new1'))
      })

      it("flags a keyword hit either way: the earlier create's keywords, or the place's own", () => {
        const wharf = { ...docks, keywords: ['the Wharf'] }
        expect(
          matchNewPlace({ name: 'The Wharf', placement: under('loc_town') }, [wharf], view),
        ).toEqual(flaggedWith('loc_new1'))
        expect(
          matchNewPlace(
            { name: 'Harbour', placement: under('loc_town'), keywords: ['docks'] },
            [docks],
            view,
          ),
        ).toEqual(flaggedWith('loc_new1'))
      })

      it('flags an unplaced place against an earlier unplaced create, unplaced', () => {
        expect(
          matchNewPlace(
            { name: 'Old Docks', placement: UNPLACED },
            [{ ...docks, placement: UNPLACED }],
            view,
          ),
        ).toEqual(flaggedWith('loc_new1', 'unplaced'))
      })

      it('compares no earlier create placed elsewhere', () => {
        expect(matchNewPlace({ name: 'Old Docks', placement: TOP }, [docks], view)).toEqual(PLAIN)
        expect(matchNewPlace({ name: 'Old Docks', placement: UNPLACED }, [docks], view)).toEqual(
          PLAIN,
        )
        expect(
          matchNewPlace(
            { name: 'Old Docks', placement: under('loc_town') },
            [{ ...docks, placement: UNPLACED }],
            view,
          ),
        ).toEqual(PLAIN)
      })

      it('reads an earlier create where a takeover put it', () => {
        const takenOver = [
          { name: 'Docks', placement: UNPLACED, id: 'loc_new1' },
          { name: 'Docks', placement: under('loc_town'), id: 'loc_new1' },
        ]
        const placedHere = new Map([['loc_new1', under('loc_town')]])
        expect(
          matchNewPlace(
            { name: 'Old Docks', placement: under('loc_town') },
            takenOver,
            view,
            placedHere,
          ),
        ).toEqual(flaggedWith('loc_new1'))
        expect(
          matchNewPlace({ name: 'Old Docks', placement: UNPLACED }, takenOver, view, placedHere),
        ).toEqual(PLAIN)
      })

      // An earlier create is newer than every row, as a later reply's would be.
      it('pairs by rank first, then a row before a create, then creates in reply order', () => {
        const yard = { name: 'Inn Yard', placement: under('loc_town'), id: 'loc_new1' }
        const stables = { name: 'Inn Stables', placement: under('loc_town'), id: 'loc_new2' }
        expect(
          matchNewPlace({ name: 'Inn', placement: under('loc_town') }, [yard, stables], view),
        ).toEqual(flaggedWith('loc_inn'))
        expect(
          matchNewPlace(
            { name: 'Inn', placement: UNPLACED },
            [
              { ...stables, placement: UNPLACED },
              { ...yard, placement: UNPLACED },
            ],
            view,
          ),
        ).toEqual(flaggedWith('loc_new2', 'unplaced'))
        const keywordRow = unhiddenLocationView([
          place('loc_town', 'Varn', null),
          place('loc_quay', 'Quay', 'loc_town', { keywords: ['Docks'] }),
        ])
        expect(
          matchNewPlace(
            { name: 'Docks', placement: under('loc_town') },
            [{ ...docks, name: 'Old Docks' }],
            keywordRow,
          ),
        ).toEqual(flaggedWith('loc_new1'))
      })
    })

    it('maps an unplaced place to its one earlier create beside a retired namesake', () => {
      const retired = unhiddenLocationView([
        place('loc_ruin', 'Ashfall', null, { status: 'retired' }),
      ])
      expect(
        matchNewPlace(
          { name: 'Ashfall', placement: UNPLACED },
          [{ name: 'Ashfall', placement: TOP, id: 'loc_new1' }],
          retired,
        ),
      ).toEqual(twin('loc_new1'))
    })
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
