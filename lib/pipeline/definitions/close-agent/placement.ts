import { and, eq } from 'drizzle-orm'

import { entities, type Entity } from '@/lib/db'
import {
  PARENT_CHAIN_BROKEN,
  PARENT_CYCLE,
  parentOfLocations,
  PLACE_REFUSAL,
  placementDrop,
  placementOf,
  realPlacementOf,
  samePlacement,
  stateOf,
  withPlacement,
  type PlacementDrop,
} from '@/lib/world'

import type { WriteContext } from './tool'
import { readStoryPlace } from '../entry-reads'

/** A placement a close sends: under a parent, or the top-level mark for an unplaced place. */
export type PlacementArg = { kind: 'under'; parentId: string } | { kind: 'top' }

export type PlacementPlan =
  | {
      ok: true
      /** The row already holds it: nothing to write. */
      restated: boolean
      /** Delta paths for entityWriteAction: the parent, null for top level. */
      wanted: Record<string, unknown>
      /** State paths it deletes: the unplaced mark, in the same write. */
      removed: string[]
    }
  | { ok: false; reason: string }

// placeLocation's own refusal strings; lib/pipeline can't import the handler.
const NOT_UNPLACED = 'not-unplaced'
const PARENT_NOT_A_PLACE = 'parent-not-a-place'

const DROP_REASON: Readonly<Record<PlacementDrop['cause'], string>> = {
  cycle: PARENT_CYCLE,
  'chain-broken': PARENT_CHAIN_BROKEN,
  [PLACE_REFUSAL.storyInside]: PLACE_REFUSAL.storyInside,
}

const refused = (reason: string): PlacementPlan => ({ ok: false, reason })
const restated = (): PlacementPlan => ({ ok: true, restated: true, wanted: {}, removed: [] })

// withPlacement writes the pair, so a placed place never keeps the unplaced mark.
function landing(row: Entity, arg: PlacementArg): PlacementPlan {
  const next = withPlacement(stateOf(row, 'location'), arg)
  return {
    ok: true,
    restated: false,
    wanted: { 'state.parent_location_id': next.parent_location_id },
    removed: next.unplaced === undefined ? ['state.unplaced'] : [],
  }
}

function branchPlaces(ctx: WriteContext) {
  return ctx.db
    .select({
      id: entities.id,
      kind: entities.kind,
      state: entities.state,
      status: entities.status,
      injectionMode: entities.injectionMode,
    })
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), eq(entities.kind, 'location')))
}

/**
 * data-model.md → LocationState shape: placeLocation's rules in order, before the write, since
 * updateEntity refuses only a loop and fails the whole call. The story's place binds a close too.
 */
export async function planPlacement(
  row: Entity,
  arg: PlacementArg,
  ctx: WriteContext,
): Promise<PlacementPlan> {
  if (samePlacement(placementOf(row), arg)) return restated()
  const places = await branchPlaces(ctx)
  if (arg.kind === 'top') {
    if (realPlacementOf(places)(row.id).kind !== 'unplaced') return refused(NOT_UNPLACED)
    return landing(row, arg)
  }
  const parent = places.find((place) => place.id === arg.parentId)
  if (parent === undefined) return refused(PARENT_NOT_A_PLACE)
  if (parent.status === 'retired') return refused(PLACE_REFUSAL.retiredParent)
  const drop = placementDrop({
    id: row.id,
    parentId: arg.parentId,
    places: new Map(places.map((place) => [place.id, place])),
    parentOf: parentOfLocations(places),
    story: await readStoryPlace(ctx.db, ctx.branchId),
  })
  if (drop !== null) return refused(DROP_REASON[drop.cause])
  return landing(row, arg)
}
