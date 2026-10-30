import { createPlanContext, type PlanDeps, type PlanResult } from './plan-context'
import { planHappenings, planKnownAwareness, planThreads } from './plan-plot'
import { planQueue } from './plan-queue'
import { planMemberships, planRelationships, planStandings } from './plan-relations'
import type { ClassifierReply } from './schema'

export { clampEmbeddedText, RECONCILED_KINDS } from './plan-creates'
export type { PlanDeps, PlannedWrite, PlanResult } from './plan-context'

export function buildClassifierActions(extraction: ClassifierReply, deps: PlanDeps): PlanResult {
  const ctx = createPlanContext(extraction, deps)

  planQueue(ctx)
  // After the queue: every row they name exists by then, and nothing in the queue reads them.
  planStandings(ctx)
  planHappenings(ctx)
  planKnownAwareness(ctx)
  planRelationships(ctx)
  planMemberships(ctx)
  planThreads(ctx)

  const { planned, handleMap, report } = ctx
  return { planned, handleMap, fellBackCount: ctx.fellBackCount(), ...report }
}
