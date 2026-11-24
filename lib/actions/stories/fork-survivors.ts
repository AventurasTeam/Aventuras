import { and, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm'

import { BIND_CHUNK, deltas, reversalJournals, type CopyPredicate } from '@/lib/db'

import type { ForkPlan } from './fork-branch'

export type SurvivorPredicates = { deltas: CopyPredicate; reversal_journals: CopyPredicate }

export type ForkSurvivorLists = {
  readonly prunedOutside: string[]
  readonly reownedInside: string[]
  /** Action ids. */
  readonly droppedJournals: string[]
}

/** The id lists the copy filters bind; throws on a window row outside the reversal set. */
export function forkSurvivorLists({ swept, plan }: NonNullable<ForkPlan>): ForkSurvivorLists {
  // The window is pruned by its predicate, never by id, so every window row must be in the set.
  const inSet = new Set(swept.set.rows.map((d) => d.id))
  const stray = swept.window.find((d) => !inSet.has(d.id))
  if (stray)
    throw new Error(`forkSurvivorLists: window delta ${stray.id} is not in the reversal set`)
  const inWindow = new Set(swept.window.map((d) => d.id))
  return {
    prunedOutside: plan.prunedDeltas.filter((d) => !inWindow.has(d.id)).map((d) => d.id),
    reownedInside: plan.reownedDeltas.filter((d) => inWindow.has(d.id)).map((d) => d.id),
    droppedJournals: plan.droppedJournals.map((j) => j.actionId),
  }
}

/**
 * Fork copy filters (data-model.md → Branch model): deltas outside the window less the pruned,
 * plus re-owned creates in it; journals less the dropped. Null `planned` (tail fork): all copy.
 */
export function forkSurvivorPredicates(planned: ForkPlan): SurvivorPredicates {
  if (planned === null) return { deltas: 'all', reversal_journals: 'all' }
  const { prunedOutside, reownedInside, droppedJournals } = forkSurvivorLists(planned)
  // BIND_CHUNK budgets one statement: the delta lists bind together, the journal list apart.
  if (prunedOutside.length + reownedInside.length > BIND_CHUNK)
    throw new Error(
      `forkSurvivorPredicates: ${prunedOutside.length} pruned outside the window and ` +
        `${reownedInside.length} re-owned in it pass ${BIND_CHUNK} binds`,
    )
  if (droppedJournals.length > BIND_CHUNK)
    throw new Error(
      `forkSurvivorPredicates: ${droppedJournals.length} dropped journals pass ${BIND_CHUNK} binds`,
    )
  // IS NOT TRUE, not NOT: an anchor the parent lacks reads NULL, which resolveSweep keeps.
  const outside: SQL[] = [sql`(${planned.swept.windowWhere}) is not true`]
  if (prunedOutside.length > 0) outside.push(notInArray(deltas.id, prunedOutside))
  const kept = and(...outside) as SQL
  return {
    deltas: reownedInside.length > 0 ? (or(kept, inArray(deltas.id, reownedInside)) as SQL) : kept,
    reversal_journals:
      droppedJournals.length > 0 ? notInArray(reversalJournals.actionId, droppedJournals) : 'all',
  }
}
