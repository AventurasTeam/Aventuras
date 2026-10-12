import { describe, expect, it } from 'vitest'

import { emptyEntityState, type Entity } from '@/lib/db'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'

import type { EntitySaveInput } from './entity-actions'
import {
  characterDraftFrom,
  itemDraftFrom,
  locationDraftFrom,
  type LocationDraft,
} from './entity-draft'
import {
  mergedPlaceOf,
  mergePlaceRefusal,
  placeSaveConfirm,
  placeSaveRefusal,
  retireCascade,
  retiredPlaceEntered,
  storyLocationIdOf,
} from './place-rules'

const place = (
  id: string,
  name: string,
  parent: string | null,
  overrides: Partial<Entity> = {},
): Entity =>
  makeEntity({ id, kind: 'location', name, state: { parent_location_id: parent }, ...overrides })

const ELDRA = place('loc_eldra', 'Eldra', null)
const VELLIS = place('loc_vellis', 'Port Vellis', 'loc_eldra')
const ANCHOR = place('loc_anchor', 'The Rusty Anchor', 'loc_vellis')
const BACK_ROOM = place('loc_back', 'the back room', 'loc_anchor')
const MARKET = place('loc_market', 'Harbor Market', 'loc_vellis')
const THORNWOOD = place('loc_thorn', 'Thornwood', null)
const WORLD = [ELDRA, VELLIS, ANCHOR, BACK_ROOM, MARKET, THORNWOOD]

const named = (e: Entity) => ({ id: e.id, name: e.name })

type LocationArgs = {
  row: Entity | null
  draft: Partial<LocationDraft>
  entities?: readonly Entity[]
  story?: string | null
}

const locationSave = ({ row, draft, entities = WORLD, story = null }: LocationArgs) => ({
  kind: 'location' as const,
  draft: { ...locationDraftFrom(row), ...draft },
  keywordsBase: [],
  row,
  branchEntities: entities,
  storyLocationId: story,
})

describe('placeSaveRefusal — retiring a place', () => {
  it('refuses while the story is in the place, on the status field', () => {
    expect(
      placeSaveRefusal(
        locationSave({ row: VELLIS, draft: { status: 'retired' }, story: 'loc_vellis' }),
      ),
    ).toEqual({
      code: 'story-inside',
      field: 'status',
      place: named(VELLIS),
      story: named(VELLIS),
    })
  })

  it('refuses while the story is anywhere inside the place', () => {
    expect(
      placeSaveRefusal(
        locationSave({ row: VELLIS, draft: { status: 'retired' }, story: 'loc_back' }),
      ),
    ).toMatchObject({ code: 'story-inside', field: 'status', story: named(BACK_ROOM) })
  })

  it('lets a place the story is outside retire', () => {
    expect(
      placeSaveRefusal(
        locationSave({ row: VELLIS, draft: { status: 'retired' }, story: 'loc_thorn' }),
      ),
    ).toBeNull()
  })

  it('refuses only on the change: a retired place the story is in still saves', () => {
    const retired = { ...VELLIS, status: 'retired' as const }
    expect(
      placeSaveRefusal(
        locationSave({
          row: retired,
          draft: { description: 'ash' },
          entities: [ELDRA, retired],
          story: 'loc_vellis',
        }),
      ),
    ).toBeNull()
  })
})

describe('placeSaveRefusal — a retired parent', () => {
  const RETIRED_VELLIS = { ...VELLIS, status: 'retired' as const }
  const RETIRED_ANCHOR = { ...ANCHOR, status: 'retired' as const }
  const world = [ELDRA, RETIRED_VELLIS, RETIRED_ANCHOR, THORNWOOD]

  it('refuses bringing back a place whose parent is retired, on the status field', () => {
    expect(
      placeSaveRefusal(
        locationSave({ row: RETIRED_ANCHOR, draft: { status: 'active' }, entities: world }),
      ),
    ).toEqual({ code: 'retired-parent', field: 'status', parent: named(RETIRED_VELLIS) })
  })

  it('names the parent field when the Save also moves it under a retired one', () => {
    const retiredThorn = { ...THORNWOOD, status: 'retired' as const }
    const moved = locationSave({
      row: RETIRED_ANCHOR,
      draft: { status: 'staged', parentLocationId: 'loc_thorn' },
      entities: [...world.filter((e) => e !== THORNWOOD), retiredThorn],
    })
    expect(placeSaveRefusal(moved)).toMatchObject({
      code: 'retired-parent',
      field: 'parentLocationId',
    })
  })

  it('lets a place come back when the same Save moves it out from under the retired parent', () => {
    expect(
      placeSaveRefusal(
        locationSave({
          row: RETIRED_ANCHOR,
          draft: { status: 'active', parentLocationId: 'loc_eldra' },
          entities: world,
        }),
      ),
    ).toBeNull()
  })

  it('refuses creating a place inside a retired one', () => {
    expect(
      placeSaveRefusal(
        locationSave({
          row: null,
          draft: { name: 'Cellar', parentLocationId: 'loc_vellis' },
          entities: world,
        }),
      ),
    ).toEqual({ code: 'retired-parent', field: 'parentLocationId', parent: named(RETIRED_VELLIS) })
  })

  it('lets a retired place be created inside a retired one', () => {
    expect(
      placeSaveRefusal(
        locationSave({
          row: null,
          draft: { name: 'Cellar', status: 'retired', parentLocationId: 'loc_vellis' },
          entities: world,
        }),
      ),
    ).toBeNull()
  })

  it('refuses moving a place that is not retired into a retired one', () => {
    expect(
      placeSaveRefusal(
        locationSave({
          row: THORNWOOD,
          draft: { parentLocationId: 'loc_vellis' },
          entities: world,
        }),
      ),
    ).toEqual({ code: 'retired-parent', field: 'parentLocationId', parent: named(RETIRED_VELLIS) })
  })

  it('lets a retired place move into a retired one', () => {
    const retiredThorn = { ...THORNWOOD, status: 'retired' as const }
    expect(
      placeSaveRefusal(
        locationSave({
          row: retiredThorn,
          draft: { parentLocationId: 'loc_vellis' },
          entities: [...world, retiredThorn],
        }),
      ),
    ).toBeNull()
  })

  it('leaves an active place already under a retired one to save its other fields', () => {
    const stray = place('loc_stray', 'Stray Room', 'loc_vellis')
    expect(
      placeSaveRefusal(
        locationSave({ row: stray, draft: { description: 'dusty' }, entities: [...world, stray] }),
      ),
    ).toBeNull()
  })

  it('leaves a parent loop to the handler, which refuses it as a cycle', () => {
    const retiredEldra = { ...ELDRA, status: 'retired' as const }
    const retiredVellis = { ...VELLIS, status: 'retired' as const }
    expect(
      placeSaveRefusal(
        locationSave({
          row: retiredEldra,
          draft: { status: 'active', parentLocationId: 'loc_vellis' },
          entities: [retiredEldra, retiredVellis],
        }),
      ),
    ).toBeNull()
  })
})

describe('placeSaveRefusal — disabling a place', () => {
  it('refuses while the story is in the place or inside it, on the mode field', () => {
    expect(
      placeSaveRefusal(
        locationSave({ row: VELLIS, draft: { injectionMode: 'disabled' }, story: 'loc_anchor' }),
      ),
    ).toEqual({
      code: 'story-inside',
      field: 'injectionMode',
      place: named(VELLIS),
      story: named(ANCHOR),
    })
  })

  it('refuses only on the change: a region the story walked into still saves', () => {
    const disabled = { ...VELLIS, injectionMode: 'disabled' as const }
    expect(
      placeSaveRefusal(
        locationSave({
          row: disabled,
          draft: { description: 'fog' },
          entities: [ELDRA, disabled, ANCHOR],
          story: 'loc_anchor',
        }),
      ),
    ).toBeNull()
  })

  it('lets a place the story is outside be disabled', () => {
    expect(
      placeSaveRefusal(
        locationSave({ row: VELLIS, draft: { injectionMode: 'disabled' }, story: 'loc_thorn' }),
      ),
    ).toBeNull()
  })
})

describe('placeSaveRefusal — moving a place into a disabled region', () => {
  const DISABLED_THORN = { ...THORNWOOD, injectionMode: 'disabled' as const }
  const world = [ELDRA, VELLIS, ANCHOR, BACK_ROOM, MARKET, DISABLED_THORN]

  it('refuses while the story is in the moved place or inside it, on the parent field', () => {
    expect(
      placeSaveRefusal(
        locationSave({
          row: ANCHOR,
          draft: { parentLocationId: 'loc_thorn' },
          entities: world,
          story: 'loc_back',
        }),
      ),
    ).toEqual({
      code: 'story-inside',
      field: 'parentLocationId',
      place: named(ANCHOR),
      story: named(BACK_ROOM),
    })
  })

  it('refuses a move under a place inside the disabled region', () => {
    const shrine = place('loc_shrine', 'Shrine', 'loc_thorn')
    expect(
      placeSaveRefusal(
        locationSave({
          row: ANCHOR,
          draft: { parentLocationId: 'loc_shrine' },
          entities: [...world, shrine],
          story: 'loc_anchor',
        }),
      ),
    ).toMatchObject({ code: 'story-inside', field: 'parentLocationId' })
  })

  it('lets a place move within a region the story already walked into', () => {
    const disabledVellis = { ...VELLIS, injectionMode: 'disabled' as const }
    expect(
      placeSaveRefusal(
        locationSave({
          row: BACK_ROOM,
          draft: { parentLocationId: 'loc_market' },
          entities: [ELDRA, disabledVellis, ANCHOR, BACK_ROOM, MARKET],
          story: 'loc_back',
        }),
      ),
    ).toBeNull()
  })

  it('refuses a move from one disabled region into another the story is not in', () => {
    const disabledVellis = { ...VELLIS, injectionMode: 'disabled' as const }
    expect(
      placeSaveRefusal(
        locationSave({
          row: BACK_ROOM,
          draft: { parentLocationId: 'loc_thorn' },
          entities: [ELDRA, disabledVellis, ANCHOR, BACK_ROOM, DISABLED_THORN],
          story: 'loc_back',
        }),
      ),
    ).toMatchObject({ code: 'story-inside', field: 'parentLocationId' })
  })

  it('lets a place the story is outside move into the region', () => {
    expect(
      placeSaveRefusal(
        locationSave({
          row: MARKET,
          draft: { parentLocationId: 'loc_thorn' },
          entities: world,
          story: 'loc_back',
        }),
      ),
    ).toBeNull()
  })
})

describe('placeSaveRefusal — entering a retired place', () => {
  const RETIRED_MARKET = { ...MARKET, status: 'retired' as const }
  const kael = makeEntity({
    id: 'char_kael',
    kind: 'character',
    name: 'Kael',
    state: { ...emptyEntityState('character'), current_location_id: 'loc_market' },
  })
  const lamp = makeEntity({
    id: 'item_lamp',
    kind: 'item',
    name: 'Lamp',
    state: { at_location_id: null },
  })
  const world = [ELDRA, VELLIS, RETIRED_MARKET, kael, lamp]
  const characterSave = (row: Entity | null, currentLocationId: string | null) => ({
    kind: 'character' as const,
    draft: { ...characterDraftFrom(row, []), currentLocationId },
    relationships: [],
    relationshipsBase: [],
    keywordsBase: [],
    row,
    branchEntities: world,
    storyLocationId: null,
  })

  it("refuses a character's move into a retired place, on its location field", () => {
    const stranger = makeEntity({
      id: 'char_new',
      kind: 'character',
      name: 'Mira',
      state: { ...emptyEntityState('character'), current_location_id: null },
    })
    expect(placeSaveRefusal(characterSave(stranger, 'loc_market'))).toEqual({
      code: 'retired-place',
      field: 'currentLocationId',
      place: named(RETIRED_MARKET),
    })
    expect(placeSaveRefusal(characterSave(null, 'loc_market'))).toMatchObject({
      code: 'retired-place',
    })
  })

  it('lets a character already in a retired place save its other fields', () => {
    expect(placeSaveRefusal(characterSave(kael, 'loc_market'))).toBeNull()
  })

  it("refuses an item's placement in a retired place, on its location field", () => {
    const itemSave = {
      kind: 'item' as const,
      draft: { ...itemDraftFrom(lamp), atLocationId: 'loc_market' },
      keywordsBase: [],
      row: lamp,
      branchEntities: world,
      storyLocationId: null,
    } satisfies EntitySaveInput & Record<string, unknown>
    expect(placeSaveRefusal(itemSave)).toEqual({
      code: 'retired-place',
      field: 'atLocationId',
      place: named(RETIRED_MARKET),
    })
  })
})

describe('retiredPlaceEntered', () => {
  const RETIRED_MARKET = { ...MARKET, status: 'retired' as const }

  it('returns the retired place a changed value names', () => {
    expect(retiredPlaceEntered('loc_market', 'loc_eldra', [ELDRA, RETIRED_MARKET])).toBe(
      RETIRED_MARKET,
    )
  })

  it('returns null for an unchanged value, an active place, a non-location and null', () => {
    expect(retiredPlaceEntered('loc_market', 'loc_market', [RETIRED_MARKET])).toBeNull()
    expect(retiredPlaceEntered('loc_eldra', null, [ELDRA])).toBeNull()
    const ghost = makeEntity({
      id: 'char_ghost',
      kind: 'character',
      name: 'Ghost',
      status: 'retired',
    })
    expect(retiredPlaceEntered('char_ghost', null, [ghost])).toBeNull()
    expect(retiredPlaceEntered(null, 'loc_market', [RETIRED_MARKET])).toBeNull()
  })
})

describe('retireCascade', () => {
  it('retires every place inside, not yet retired, with the same reason, in one group', () => {
    const retiredBack = { ...BACK_ROOM, status: 'retired' as const, retiredReason: 'collapsed' }
    const actions = retireCascade({
      branchId: 'br_1',
      row: VELLIS,
      draft: {
        ...locationDraftFrom(VELLIS),
        status: 'retired',
        retiredReason: ' sank beneath the waves ',
      },
      branchEntities: [ELDRA, VELLIS, ANCHOR, retiredBack, MARKET, THORNWOOD],
    })
    expect(actions).toEqual([
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'loc_anchor',
          patch: { status: 'retired', retiredReason: 'sank beneath the waves' },
        },
      },
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: 'br_1',
          id: 'loc_market',
          patch: { status: 'retired', retiredReason: 'sank beneath the waves' },
        },
      },
    ])
  })

  it('cascades a blank reason as none', () => {
    const [action] = retireCascade({
      branchId: 'br_1',
      row: ANCHOR,
      draft: { ...locationDraftFrom(ANCHOR), status: 'retired', retiredReason: '  ' },
      branchEntities: WORLD,
    })
    expect(action).toMatchObject({ payload: { id: 'loc_back', patch: { retiredReason: null } } })
  })

  it('writes nothing unless the Save retires the place', () => {
    const retired = { ...VELLIS, status: 'retired' as const }
    expect(
      retireCascade({
        branchId: 'br_1',
        row: retired,
        draft: { ...locationDraftFrom(retired), retiredReason: 'new' },
        branchEntities: [ELDRA, retired, ANCHOR],
      }),
    ).toEqual([])
    expect(
      retireCascade({
        branchId: 'br_1',
        row: null,
        draft: { ...locationDraftFrom(null), status: 'retired' },
        branchEntities: WORLD,
      }),
    ).toEqual([])
  })

  it('terminates on a looping subtree', () => {
    const loopA = place('loc_la', 'Ashgate', 'loc_lb')
    const loopB = place('loc_lb', 'Bellmoor', 'loc_la')
    const actions = retireCascade({
      branchId: 'br_1',
      row: loopA,
      draft: { ...locationDraftFrom(loopA), status: 'retired' },
      branchEntities: [loopA, loopB],
    })
    expect(actions.map((a) => (a.kind === 'updateEntity' ? a.payload.id : null))).toEqual([
      'loc_lb',
    ])
  })
})

describe('placeSaveConfirm', () => {
  it('lists the places a retire takes, by name, and none already retired', () => {
    const retiredBack = { ...BACK_ROOM, status: 'retired' as const }
    expect(
      placeSaveConfirm(
        locationSave({
          row: VELLIS,
          draft: { status: 'retired' },
          entities: [ELDRA, VELLIS, ANCHOR, retiredBack, MARKET],
        }),
      ),
    ).toEqual({
      retire: { place: named(VELLIS), inside: [named(MARKET), named(ANCHOR)] },
      disable: null,
      move: null,
    })
  })

  it('asks nothing for a retire with no places inside', () => {
    expect(
      placeSaveConfirm(locationSave({ row: THORNWOOD, draft: { status: 'retired' } })),
    ).toBeNull()
  })

  it('counts the places a disable takes that are not already disabled', () => {
    const disabledBack = { ...BACK_ROOM, injectionMode: 'disabled' as const }
    expect(
      placeSaveConfirm(
        locationSave({
          row: VELLIS,
          draft: { injectionMode: 'disabled' },
          entities: [ELDRA, VELLIS, ANCHOR, disabledBack, MARKET],
        }),
      ),
    ).toEqual({ retire: null, disable: { place: named(VELLIS), count: 2 }, move: null })
  })

  it('asks nothing for a disable whose places inside are all disabled already', () => {
    const disabledBack = { ...BACK_ROOM, injectionMode: 'disabled' as const }
    expect(
      placeSaveConfirm(
        locationSave({
          row: ANCHOR,
          draft: { injectionMode: 'disabled' },
          entities: [ELDRA, VELLIS, ANCHOR, disabledBack],
        }),
      ),
    ).toBeNull()
  })

  it('names the disabled region a move enters and counts the places inside the moved one', () => {
    const disabledThorn = { ...THORNWOOD, injectionMode: 'disabled' as const }
    const closet = place('loc_closet', 'Closet', 'loc_anchor', { injectionMode: 'disabled' })
    expect(
      placeSaveConfirm(
        locationSave({
          row: ANCHOR,
          draft: { parentLocationId: 'loc_thorn' },
          entities: [ELDRA, VELLIS, ANCHOR, BACK_ROOM, closet, disabledThorn],
        }),
      ),
    ).toEqual({
      retire: null,
      disable: null,
      move: { region: named(disabledThorn), place: named(ANCHOR), count: 1 },
    })
  })

  // Q3: asks even while the story's presence suspends the region, as it will drop out later.
  it('asks for a move into a region the story is inside elsewhere', () => {
    const disabledThorn = { ...THORNWOOD, injectionMode: 'disabled' as const }
    const shrine = place('loc_shrine', 'Shrine', 'loc_thorn')
    const confirm = placeSaveConfirm(
      locationSave({
        row: MARKET,
        draft: { parentLocationId: 'loc_thorn' },
        entities: [ELDRA, VELLIS, MARKET, disabledThorn, shrine],
        story: 'loc_shrine',
      }),
    )
    expect(confirm?.move).toEqual({ region: named(disabledThorn), place: named(MARKET), count: 0 })
  })

  it('asks nothing for a move of a place already out of the story', () => {
    const disabledThorn = { ...THORNWOOD, injectionMode: 'disabled' as const }
    const disabledVellis = { ...VELLIS, injectionMode: 'disabled' as const }
    const ownDisabled = { ...ANCHOR, injectionMode: 'disabled' as const }
    expect(
      placeSaveConfirm(
        locationSave({
          row: ownDisabled,
          draft: { parentLocationId: 'loc_thorn' },
          entities: [ELDRA, VELLIS, ownDisabled, disabledThorn],
        }),
      ),
    ).toBeNull()
    expect(
      placeSaveConfirm(
        locationSave({
          row: ANCHOR,
          draft: { parentLocationId: 'loc_thorn' },
          entities: [ELDRA, disabledVellis, ANCHOR, disabledThorn],
        }),
      ),
    ).toBeNull()
  })

  it('asks nothing for a move within a disabled region', () => {
    const disabledVellis = { ...VELLIS, injectionMode: 'disabled' as const }
    expect(
      placeSaveConfirm(
        locationSave({
          row: BACK_ROOM,
          draft: { parentLocationId: 'loc_market' },
          entities: [ELDRA, disabledVellis, ANCHOR, BACK_ROOM, MARKET],
        }),
      ),
    ).toBeNull()
  })

  it('asks once with both lines when a Save retires and moves into a disabled region', () => {
    const disabledThorn = { ...THORNWOOD, injectionMode: 'disabled' as const }
    const confirm = placeSaveConfirm(
      locationSave({
        row: ANCHOR,
        draft: { status: 'retired', parentLocationId: 'loc_thorn' },
        entities: [ELDRA, VELLIS, ANCHOR, BACK_ROOM, disabledThorn],
      }),
    )
    expect(confirm?.retire).toEqual({ place: named(ANCHOR), inside: [named(BACK_ROOM)] })
    expect(confirm?.move).toMatchObject({ region: named(disabledThorn) })
  })

  it('asks nothing before a Save that will be refused', () => {
    expect(
      placeSaveConfirm(
        locationSave({ row: VELLIS, draft: { status: 'retired' }, story: 'loc_anchor' }),
      ),
    ).toBeNull()
  })

  it('asks nothing for a create', () => {
    const disabledThorn = { ...THORNWOOD, injectionMode: 'disabled' as const }
    expect(
      placeSaveConfirm(
        locationSave({
          row: null,
          draft: { name: 'Hut', parentLocationId: 'loc_thorn' },
          entities: [disabledThorn],
        }),
      ),
    ).toBeNull()
  })
})

describe('storyLocationIdOf', () => {
  const meta = (currentLocationId: string | null) => ({
    sceneEntities: [],
    currentLocationId,
    worldTime: 0,
  })

  // generation-context's readSceneSource: the latest ai_reply or opening, whatever sits after it.
  it("reads the latest narrative entry's location, past actions with no scene", () => {
    expect(
      storyLocationIdOf([
        { kind: 'opening', metadata: meta('loc_a') },
        { kind: 'ai_reply', metadata: meta('loc_b') },
        { kind: 'user_action', metadata: null },
        { kind: 'user_action', metadata: null },
      ]),
    ).toBe('loc_b')
  })

  it('reads no location from a narrative entry with no scene, or from no entries', () => {
    expect(
      storyLocationIdOf([
        { kind: 'opening', metadata: meta('loc_a') },
        { kind: 'ai_reply', metadata: null },
      ]),
    ).toBeNull()
    expect(storyLocationIdOf([])).toBeNull()
  })
})

describe('mergedPlaceOf', () => {
  it("reads the canonical's merged status, mode and parent off its built patch", () => {
    expect(
      mergedPlaceOf(
        [
          {
            kind: 'updateEntity',
            source: 'user_edit',
            payload: {
              branchId: 'br_1',
              id: 'loc_anchor',
              patch: {
                status: 'retired',
                injectionMode: 'disabled',
                state: { parent_location_id: null },
              },
            },
          },
        ],
        ANCHOR,
      ),
    ).toEqual({ status: 'retired', injectionMode: 'disabled', parentId: null })
  })

  it("keeps the canonical's own values where the patch leaves them, and promotes it when told to", () => {
    expect(mergedPlaceOf([], { ...ANCHOR, status: 'staged' })).toEqual({
      status: 'staged',
      injectionMode: 'auto',
      parentId: 'loc_vellis',
    })
    expect(
      mergedPlaceOf(
        [
          {
            kind: 'promoteStagedEntity',
            source: 'user_edit',
            payload: { branchId: 'br_1', id: 'loc_anchor', proseEntryId: null },
          },
        ],
        { ...ANCHOR, status: 'staged' },
      ).status,
    ).toBe('active')
  })
})

describe('mergePlaceRefusal', () => {
  const DUPLICATE = place('loc_dup', 'Rusty Anchor', 'loc_vellis')
  const world = [...WORLD, DUPLICATE]
  const merge = (
    merged: Partial<{
      status: Entity['status']
      injectionMode: Entity['injectionMode']
      parentId: string | null
    }>,
    opts: {
      entities?: readonly Entity[]
      story?: string | null
      canonical?: Entity
      loser?: Entity
    } = {},
  ) =>
    mergePlaceRefusal({
      canonical: opts.canonical ?? ANCHOR,
      loser: opts.loser ?? DUPLICATE,
      merged: { status: 'active', injectionMode: 'auto', parentId: 'loc_vellis', ...merged },
      branchEntities: opts.entities ?? world,
      storyLocationId: opts.story ?? null,
    })

  it('refuses a retired result while the story is in either place', () => {
    expect(merge({ status: 'retired' }, { story: 'loc_dup' })).toBe('story-inside')
    expect(merge({ status: 'retired' }, { story: 'loc_back' })).toBe('story-inside')
  })

  it('refuses a retired result while either has a place inside that is not retired', () => {
    expect(merge({ status: 'retired' })).toBe('places-inside')
    const cellar = place('loc_cellar', 'Cellar', 'loc_dup')
    const retiredBack = { ...BACK_ROOM, status: 'retired' as const }
    expect(
      merge(
        { status: 'retired' },
        { entities: [ELDRA, VELLIS, ANCHOR, retiredBack, DUPLICATE, cellar] },
      ),
    ).toBe('places-inside')
  })

  it('lets a retired result through when everything inside is retired', () => {
    const retiredBack = { ...BACK_ROOM, status: 'retired' as const }
    expect(
      merge({ status: 'retired' }, { entities: [ELDRA, VELLIS, ANCHOR, retiredBack, DUPLICATE] }),
    ).toBeNull()
  })

  it('refuses a result that is not retired under a retired parent', () => {
    const retiredVellis = { ...VELLIS, status: 'retired' as const }
    expect(
      merge({ status: 'active' }, { entities: [ELDRA, retiredVellis, ANCHOR, DUPLICATE] }),
    ).toBe('retired-parent')
  })

  it('brings a retired row back through a merge, its retired children inside the active result', () => {
    const retiredAnchor = { ...ANCHOR, status: 'retired' as const }
    const retiredBack = { ...BACK_ROOM, status: 'retired' as const }
    expect(
      merge(
        { status: 'active' },
        {
          canonical: retiredAnchor,
          entities: [ELDRA, VELLIS, retiredAnchor, retiredBack, DUPLICATE],
        },
      ),
    ).toBeNull()
  })

  // Q1, revised: the story's place lands in a disabled region it wasn't already in.
  it('refuses when the story is in the loser and the canonical is disabled', () => {
    expect(merge({ injectionMode: 'disabled' }, { story: 'loc_dup' })).toBe('story-inside')
  })

  it('refuses when the story is in the loser and the canonical sits under a disabled place', () => {
    const disabledThorn = { ...THORNWOOD, injectionMode: 'disabled' as const }
    const hut = place('loc_hut', 'Rusty Anchor', 'loc_thorn')
    expect(
      merge(
        { parentId: 'loc_thorn' },
        {
          canonical: hut,
          loser: ANCHOR,
          entities: [ELDRA, VELLIS, ANCHOR, BACK_ROOM, disabledThorn, hut],
          story: 'loc_back',
        },
      ),
    ).toBe('story-inside')
  })

  it('refuses when the story is in the canonical and the merged mode turns disabled', () => {
    expect(merge({ injectionMode: 'disabled' }, { story: 'loc_back' })).toBe('story-inside')
  })

  it('lets a merge inside the region the story walked into through', () => {
    const disabledVellis = { ...VELLIS, injectionMode: 'disabled' as const }
    const entities = [ELDRA, disabledVellis, ANCHOR, BACK_ROOM, DUPLICATE]
    expect(merge({}, { entities, story: 'loc_dup' })).toBeNull()
    expect(merge({}, { entities, story: 'loc_back' })).toBeNull()
  })

  it('lets a disabled loser merge into a disabled canonical the story is in', () => {
    const disabledAnchor = { ...ANCHOR, injectionMode: 'disabled' as const }
    const disabledDup = { ...DUPLICATE, injectionMode: 'disabled' as const }
    expect(
      merge(
        { injectionMode: 'disabled' },
        {
          canonical: disabledAnchor,
          loser: disabledDup,
          entities: [ELDRA, VELLIS, disabledAnchor, disabledDup],
          story: 'loc_dup',
        },
      ),
    ).toBeNull()
  })

  // A nested pair: the story's chain runs through the inner row, so its own mode counts before.
  it('lets a disabled canonical inside the loser keep the story it already holds', () => {
    const outer = place('loc_outer', 'Rusty Anchor', 'loc_vellis')
    const inner = place('loc_inner', 'Rusty Anchor', 'loc_outer', { injectionMode: 'disabled' })
    const room = place('loc_room', 'Cellar', 'loc_inner')
    expect(
      merge(
        { injectionMode: 'disabled', parentId: null },
        {
          canonical: inner,
          loser: outer,
          entities: [ELDRA, VELLIS, outer, inner, room],
          story: 'loc_room',
        },
      ),
    ).toBeNull()
  })

  it('lets a disabled loser inside the canonical hand its mode to the place around the story', () => {
    const outer = place('loc_outer', 'Rusty Anchor', 'loc_vellis')
    const inner = place('loc_inner', 'Rusty Anchor', 'loc_outer', { injectionMode: 'disabled' })
    expect(
      merge(
        { injectionMode: 'disabled' },
        {
          canonical: outer,
          loser: inner,
          entities: [ELDRA, VELLIS, outer, inner],
          story: 'loc_inner',
        },
      ),
    ).toBeNull()
  })

  it("still refuses a nested merge that turns the story's place disabled", () => {
    const outer = place('loc_outer', 'Rusty Anchor', 'loc_vellis')
    const inner = place('loc_inner', 'Rusty Anchor', 'loc_outer')
    expect(
      merge(
        { injectionMode: 'disabled', parentId: null },
        {
          canonical: inner,
          loser: outer,
          entities: [ELDRA, VELLIS, outer, inner],
          story: 'loc_inner',
        },
      ),
    ).toBe('story-inside')
  })

  it('lets a merge the story is outside through', () => {
    expect(merge({ injectionMode: 'disabled' }, { story: 'loc_thorn' })).toBeNull()
  })
})
