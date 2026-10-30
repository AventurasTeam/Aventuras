import { dedupeTerms } from '@/lib/keyword-terms'
import {
  matchNewPlace,
  parentOfLocations,
  placementDrop,
  placeNewLocation,
  realPlacementOf,
  replyMatchView,
  replyParentOf,
  settlingOrder,
  TOP_LEVEL,
  unhiddenLocationView,
  withPlacement,
  type ParentOf,
  type PlacedPlacement,
  type PlacementDrop,
  type PlacePlacement,
  type SettledNewPlace,
} from '@/lib/world'

import {
  nonBlank,
  SOURCE,
  stateText,
  type DroppedPlacement,
  type PlanContext,
} from './plan-context'
import { clampEmbeddedText } from './plan-creates'
import { newPlacesOf, TOP_LEVEL_TOKEN, type NewPlace, type Placement } from './schema'

// classifier.md → Mentioned places → Parent: a parent the planner can't use leaves it unplaced.
const UNPLACED: PlacePlacement = { kind: 'unplaced' }

const isTopLevel = (parent: string | undefined): boolean =>
  parent?.trim().toLowerCase() === TOP_LEVEL_TOKEN

// The schema's "top-level" is the shared placement helpers' TOP_LEVEL.
function declaredPlace(place: NewPlace): NewPlace {
  return isTopLevel(place.parent) ? { ...place, parent: TOP_LEVEL } : place
}

type PlacementJudgment =
  | { kind: 'place'; id: string; placement: PlacedPlacement }
  | { kind: 'restated' }
  | { kind: 'unseen' }
  | { kind: 'unresolved'; parent: string }
  | { kind: 'dropped'; drop: DroppedPlacement }

// A mark after a placement this reply sent lands only if that one is refused: keep the view.
function notePlacement(
  placements: Map<string, PlacedPlacement>,
  id: string,
  placement: PlacedPlacement,
  placedEarlier: boolean,
): void {
  if (placement.kind === 'under' || !placedEarlier) placements.set(id, placement)
}

/**
 * classifier.md → What the classifier writes → Where a place sits. Judged against this reply's own
 * creates and placements, so a drop happens before the handler sees the fact.
 *
 * Each placement plans, and so writes, before any new place of its turn or a later one: a new
 * place matches and is checked where the placements ahead of it leave the places, as they land.
 */
export function placementPlanner(ctx: PlanContext): (position: number) => void {
  const { extraction, deps, planned, handleMap, report, rowById, placedHere, createdPlaces } = ctx
  const { branchId, entities, story } = deps
  const realPlacement = realPlacementOf(entities.filter((e) => e.kind === 'location'))
  const placementFacts = ctx.inTurnOrder(extraction.placements)
  // A new place's handle, which a placement may name before the place settles.
  const placeHandles = new Set(
    newPlacesOf(extraction).flatMap((p) => (nonBlank(p.name) == null ? [] : [p.handle])),
  )
  // `placedEarlier`: this reply placed the row before. Only the stored placement rules a fact
  // out otherwise: the handler may refuse one this reply sent.
  const judgePlacement = (
    fact: Placement,
    placedEarlier: boolean,
    parentOf: ParentOf,
  ): PlacementJudgment => {
    const row = rowById.get(fact.ref)
    if (row === undefined) return { kind: 'unseen' }
    if (row.kind !== 'location')
      return { kind: 'dropped', drop: { ref: fact.ref, cause: 'not-a-location' } }
    const { id } = row
    if (isTopLevel(fact.parent)) {
      // Only an unplaced place is marked top-level (data-model.md → Authorship contract).
      if (realPlacement(id).kind !== 'unplaced')
        return { kind: 'dropped', drop: { ref: fact.ref, cause: 'not-unplaced' } }
      return { kind: 'place', id, placement: { kind: 'top' } }
    }
    // An ID from Places: a new place's handle names none, its create carrying its own parent.
    const parentId = fact.parent
    const parent = rowById.get(parentId)
    if (parent?.kind !== 'location') {
      if (parent === undefined && !handleMap.has(parentId) && !placeHandles.has(parentId))
        return { kind: 'unresolved', parent: parentId }
      const cause = parent === undefined ? 'parent-not-listed' : 'parent-not-a-place'
      return { kind: 'dropped', drop: { ref: fact.ref, parent: parentId, cause } }
    }
    if (!placedEarlier && parentOf(id) === parentId) return { kind: 'restated' }
    if (parent.status === 'retired')
      return { kind: 'dropped', drop: { ref: fact.ref, cause: 'retired' } }
    const drop = placementDrop({ id, parentId, places: rowById, parentOf, story })
    if (drop !== null) return { kind: 'dropped', drop: { ref: fact.ref, cause: drop.cause } }
    return { kind: 'place', id, placement: { kind: 'under', parentId } }
  }

  let placementsPlanned = 0
  return (position) => {
    for (; placementsPlanned < placementFacts.length; placementsPlanned++) {
      const fact = placementFacts[placementsPlanned]
      if (ctx.turnPosition(fact.sourceTurn) > position) return
      const placedEarlier = placedHere.has(fact.ref)
      const parentOf = replyParentOf(placedHere, parentOfLocations([...entities, ...createdPlaces]))
      const judged = judgePlacement(fact, placedEarlier, parentOf)
      if (judged.kind === 'unseen') report.unseenRefs.push({ list: 'placements', ref: fact.ref })
      else if (judged.kind === 'unresolved') report.unresolvedRefs.push(judged.parent)
      else if (judged.kind === 'dropped') report.droppedPlacements.push(judged.drop)
      if (judged.kind !== 'place') continue
      const { id, placement } = judged
      notePlacement(placedHere, id, placement, placedEarlier)
      planned.push({
        action: {
          kind: 'placeLocation',
          source: SOURCE,
          payload: { branchId, id, placement, proseEntryId: ctx.proseSource(fact.sourceTurn) },
        },
        entryId: ctx.anchor(fact.sourceTurn),
      })
    }
  }
}

/**
 * classifier.md → Mentioned places. After characters and factions, so the handle namespace they
 * share keeps their bindings; before anything that names a place by its handle.
 */
export function planNewPlaces(
  ctx: PlanContext,
  planPlacementsThrough: (position: number) => void,
): void {
  const { extraction, deps, planned, handleMap, index, report, rowById } = ctx
  const { placedHere, createdPlaces, anchorOnce, proseSource } = ctx
  const { branchId, entities, now, newId, story } = deps
  // The pass saw every place, so matching is over real children: nothing is hidden.
  const view = unhiddenLocationView(entities)
  const placed: SettledNewPlace[] = []
  // By row and parent: the pass keeps no one chain, so another parent's placement walks anew.
  const reuseDrops = new Map<string, PlacementDrop>()
  const dropKey = (id: string, parentId: string): string => `${id} ${parentId}`

  const declared: NewPlace[] = []
  for (const place of newPlacesOf(extraction)) {
    const { handle, name } = place
    if (nonBlank(name) == null) report.droppedPlaces.push({ handle, name, cause: 'blank-name' })
    else if (handleMap.has(handle))
      report.droppedPlaces.push({ handle, name, cause: 'handle-taken' })
    else declared.push(declaredPlace(place))
  }

  // A repeated handle keeps its first declaration in the reply's order, before turns reorder it.
  const firsts = new Map<string, NewPlace>()
  for (const place of declared) {
    const { handle, name } = place
    if (firsts.has(handle)) report.droppedPlaces.push({ handle, name, cause: 'handle-taken' })
    else firsts.set(handle, place)
  }
  // classifier.md → Mentioned places: in turn order, ties in the reply's order, as successive
  // passes would meet them; each still waits for its own parent.
  const { order } = settlingOrder(
    ctx.inTurnOrder([...firsts.values()]),
    (id) => rowById.get(id)?.kind === 'location',
  )
  for (const settling of order) {
    const place = settling.emission
    planPlacementsThrough(ctx.turnPosition(place.sourceTurn))
    const parentOf = replyParentOf(placedHere, parentOfLocations([...entities, ...createdPlaces]))
    const placement = placeNewLocation({
      place: settling,
      resolve: (parent) => handleMap.get(parent) ?? parent,
      statusOf: (id) => index.get(id)?.status,
      parentOf,
    })
    if (placement.kind === 'dropped')
      report.parentDrops.push({
        handle: place.handle,
        parent: placement.parent,
        cause: placement.cause,
      })
    const candidate = placement.kind === 'kept' ? placement.placement : UNPLACED

    const stored = clampEmbeddedText({
      name: place.name,
      description: place.description.trim(),
    })
    const match = matchNewPlace(
      { name: stored.name, placement: candidate, keywords: place.keywords },
      placed,
      replyMatchView(view, placedHere),
      placedHere,
    )

    let id: string
    if (match.kind !== 'create') {
      // A reused place keeps its description and its status: a mention doesn't enter it.
      id = match.id
      // One fact, one anchor: its terms and its placement count one fallback between them.
      const at = anchorOnce(place.sourceTurn)
      ctx.mentionTerms.push({
        id,
        terms: place.keywords,
        sourceTurn: place.sourceTurn,
        proseEntryId: proseSource(place.sourceTurn),
        entryId: at,
      })
      // `match.place`: an unplaced reused row, or this reply's own create taken over.
      if (match.place && candidate.kind !== 'unplaced') {
        const drop =
          candidate.kind === 'under'
            ? placementDrop({
                id,
                parentId: candidate.parentId,
                places: rowById,
                parentOf,
                story,
              })
            : null
        if (drop === null) {
          placedHere.set(id, candidate)
          planned.push({
            action: {
              kind: 'placeLocation',
              source: SOURCE,
              payload: {
                branchId,
                id,
                placement: candidate,
                proseEntryId: proseSource(place.sourceTurn),
              },
            },
            entryId: at(),
          })
        } else {
          reuseDrops.set(dropKey(id, drop.parent), drop)
          report.parentDrops.push({ handle: place.handle, ...drop })
        }
      } else if (candidate.kind === 'under') {
        // A twin of a reuse whose placement was dropped maps to the same row, left unplaced too.
        const drop = reuseDrops.get(dropKey(id, candidate.parentId))
        if (drop !== undefined) report.parentDrops.push({ handle: place.handle, ...drop })
      }
    } else {
      id = newId('loc')
      const { flag } = match
      const keywords = dedupeTerms(place.keywords)
      const timestamp = now()
      // classifier.md → What the classifier writes → First profiles: a place's condition.
      const condition = stateText(place.condition, (cut) =>
        report.cutTexts.push({ kind: 'condition', handle: place.handle, ...cut }),
      )
      const state = withPlacement(
        condition === undefined
          ? { parent_location_id: null }
          : { parent_location_id: null, condition },
        candidate,
      )
      index.set(id, { kind: 'location', status: 'active', keywords })
      createdPlaces.push({ id, kind: 'location', state })
      planned.push({
        action: {
          kind: 'createEntity',
          source: SOURCE,
          payload: {
            entry: {
              id,
              branchId,
              kind: 'location',
              name: stored.name,
              description: stored.description === '' ? null : stored.description,
              keywords,
              status: 'active',
              injectionMode: 'auto',
              state,
              nameCollisionFlag: flag === null ? 0 : 1,
              nameCollisionPartnerId: flag?.partnerId ?? null,
              nameCollisionReason: flag?.reason ?? null,
              embeddingStale: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          },
        },
        entryId: ctx.anchor(place.sourceTurn),
      })
    }
    handleMap.set(place.handle, id)
    placed.push({ name: stored.name, placement: candidate, id, keywords: place.keywords })
  }
}
