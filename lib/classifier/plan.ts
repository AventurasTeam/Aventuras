import { createPlanContext, type PlanDeps, type PlanResult } from './plan-context'
import { planNewEntities } from './plan-creates'
import { planKeywordWrites } from './plan-names'
import { placementPlanner, planNewPlaces } from './plan-places'
import { planHappenings, planKnownAwareness, planThreads } from './plan-plot'
import { planMemberships, planRelationships, planStandings } from './plan-relations'
import { planStatusFlips } from './plan-status'
import type { ClassifierReply } from './schema'

export { clampEmbeddedText, RECONCILED_KINDS } from './plan-creates'
export type { PlanDeps, PlannedWrite, PlanResult } from './plan-context'

export function buildClassifierActions(extraction: ClassifierReply, deps: PlanDeps): PlanResult {
  const ctx = createPlanContext(extraction, deps)

  // New characters first: later refs in the same reply resolve through handleMap,
  // and involvements/awareness rows must not precede the row they point at. Factions next,
  // so a handle a character claimed stays the character's.
  planNewEntities(ctx, 'character')
  planNewEntities(ctx, 'faction')

  const planPlacementsThrough = placementPlanner(ctx)
  planNewPlaces(ctx, planPlacementsThrough)
  // Placements first, so a place's rename clash is judged where this reply leaves it; they read
  // no names or keywords, and `name-taken` ignores parents downstream.
  planPlacementsThrough(Number.POSITIVE_INFINITY)
  planKeywordWrites(ctx)
  planStandings(ctx)
  planHappenings(ctx)
  planKnownAwareness(ctx)
  planRelationships(ctx)
  planMemberships(ctx)
  planStatusFlips(ctx)
  planThreads(ctx)

  const { planned, handleMap, report } = ctx
  return { planned, handleMap, fellBackCount: ctx.fellBackCount(), ...report }
}
