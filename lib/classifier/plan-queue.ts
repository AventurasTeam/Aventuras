import type { PlanContext } from './plan-context'
import { claimNewEntities, planNewEntity, type ClaimedEntity } from './plan-creates'
import { planAlias, renamePlanner } from './plan-names'
import { claimNewPlaces, newPlacePlanner, placementPlanner } from './plan-places'
import { planStatusFlip } from './plan-status'

type QueuedFact = { at: number; plan: () => void }

/**
 * classifier.md → Planning order. Queued in the list order of one turn, so a sort by position alone
 * keeps it within a turn. Handles are claimed first: the queue reorders the entries that claim them.
 * A keyword write's undo is the whole prior list, so turn order also keeps a reversal from writing
 * an earlier turn's terms away (classifier.md → Provenance attribution).
 */
export function planQueue(ctx: PlanContext): void {
  const { extraction, turnPosition } = ctx
  const entities: ClaimedEntity[] = [
    ...claimNewEntities(ctx, 'character'),
    ...claimNewEntities(ctx, 'faction'),
  ]
  const places = claimNewPlaces(ctx)

  // Where each create lands: a new place at its parent's position when that is later, anchored at
  // its own turn still (classifier.md → Mentioned places).
  const createdAt = new Map<string, number>()
  for (const { candidate, decision } of entities)
    if (decision.kind === 'create')
      createdAt.set(candidate.handle, turnPosition(candidate.sourceTurn))
  for (const { emission } of places) {
    const own = turnPosition(emission.sourceTurn)
    const parent = emission.parent === undefined ? undefined : createdAt.get(emission.parent)
    createdAt.set(emission.handle, Math.max(own, parent ?? own))
  }

  const planPlacement = placementPlanner(ctx)
  const planRename = renamePlanner(ctx)
  const planNewPlace = newPlacePlanner(ctx)
  const queue: QueuedFact[] = [
    ...entities.map((claim) => ({
      at: turnPosition(claim.candidate.sourceTurn),
      plan: () => planNewEntity(ctx, claim),
    })),
    ...extraction.placements.map((fact) => ({
      at: turnPosition(fact.sourceTurn),
      plan: () => planPlacement(fact),
    })),
    ...extraction.renames.map((fact) => ({
      at: turnPosition(fact.sourceTurn),
      plan: () => planRename(fact),
    })),
    ...extraction.aliases.map((fact) => ({
      at: turnPosition(fact.sourceTurn),
      plan: () => planAlias(ctx, fact),
    })),
    ...places.map((settling) => ({
      at: createdAt.get(settling.emission.handle) ?? turnPosition(settling.emission.sourceTurn),
      plan: () => planNewPlace(settling),
    })),
    // Waits for a row it names that a later position creates, as a new place waits for its parent.
    ...ctx.inTurnOrder(extraction.statusFlips).map((flip) => ({
      at: Math.max(turnPosition(flip.sourceTurn), createdAt.get(flip.ref) ?? 0),
      plan: () => planStatusFlip(ctx, flip),
    })),
  ]
  for (const fact of ctx.byPosition(queue, (queued) => queued.at)) fact.plan()
}
