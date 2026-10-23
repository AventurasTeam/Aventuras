import type { EntryMetadata } from '@/lib/db'

import type { ParsedTransfers, PlannedTurn } from './types'

type StateReport = NonNullable<EntryMetadata['stateReport']>
type ReportedTransfers = NonNullable<StateReport['transfers']>
type ReportedDrop = NonNullable<ReportedTransfers['drops']>[number]

// data-model.md → Entry metadata shape: the moves as emitted, without the order apply.ts followed,
// and each drop where apply.ts put it, never the block's own.
function reportedTransfers(
  transfers: ParsedTransfers,
  drops: readonly ReportedDrop[],
): ReportedTransfers {
  return {
    items: transfers.items.map(({ seq, ...item }) => item),
    stackables: transfers.stackables,
    ...(drops.length > 0 ? { drops: [...drops] } : {}),
  }
}

type BuildReportArgs = {
  layer: StateReport['layer']
  /** Real entity ids in the block, never placeholders, nor create handles bar a rejected
   *  `currentLocation`; what became of each create in the report, whose lists are written only
   *  when they hold an entry. */
  turn: Pick<PlannedTurn, 'block' | 'report'>
  /** Widened to plain strings: a report read back from the column has already lost
   *  the `keyof ParsedStateBlock` narrowing, and the fallback re-supplies its own. */
  failures: { field: string; detail: string }[]
  /** The trailing block's own text. Retained only when a field failed. */
  raw?: string
  /** What apply.ts did with the emitted values. Absent when nothing was applied. */
  applied?: {
    worldTimeDelta: number
    currentLocationRejected: boolean
    drops: readonly ReportedDrop[]
    conditionsRejected: readonly number[]
  }
}

/**
 * Emitted vs. applied causes collapse onto one diff (entry-card.md → Emitted vs. applied).
 * `summary`/`retrievalQueries` omitted: they already live top-level on EntryMetadata.
 */
export function buildStateReport(args: BuildReportArgs): EntryMetadata['stateReport'] {
  const { layer, failures, raw, applied } = args
  const { block, report } = args.turn
  const { newLocations, newItems } = report
  // Emptiness is judged on the block as emitted, summary included: suppressing a summary-only
  // report would badge the turn as one where piggyback never ran. Creates count too: the planner
  // strips them from the block.
  if (
    Object.keys(block).length === 0 &&
    failures.length === 0 &&
    newLocations.length === 0 &&
    newItems.length === 0
  )
    return undefined

  return {
    layer,
    ...(block.sceneEntities !== undefined ? { sceneEntities: block.sceneEntities } : {}),
    ...(block.currentLocation !== undefined ? { currentLocation: block.currentLocation } : {}),
    ...(block.worldTimeDelta !== undefined ? { worldTimeDelta: block.worldTimeDelta } : {}),
    ...(block.worldTimeDelta !== undefined && applied !== undefined
      ? { worldTimeDeltaApplied: applied.worldTimeDelta }
      : {}),
    ...(applied?.currentLocationRejected === true
      ? { currentLocationRejected: true as const }
      : {}),
    ...(block.visualChanges !== undefined ? { visualChanges: block.visualChanges } : {}),
    ...(block.conditions !== undefined
      ? {
          conditions: block.conditions.map((condition, position) =>
            applied?.conditionsRejected.includes(position) === true
              ? { ...condition, rejected: true as const }
              : condition,
          ),
        }
      : {}),
    ...(block.transfers !== undefined
      ? { transfers: reportedTransfers(block.transfers, applied?.drops ?? []) }
      : {}),
    ...(newLocations.length > 0 ? { newLocations } : {}),
    ...(newItems.length > 0 ? { newItems } : {}),
    ...(failures.length > 0
      ? { failedFields: failures.map((f) => ({ field: f.field, detail: f.detail })) }
      : {}),
    // Redundant on the happy path; the only inspectable remnant when a parse failed.
    ...(failures.length > 0 && raw !== undefined ? { raw } : {}),
  }
}
