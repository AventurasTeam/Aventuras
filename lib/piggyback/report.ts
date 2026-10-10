import type { EntryMetadata } from '@/lib/db'

import type { NewItemReport, NewLocationReport, ParsedStateBlock, TurnCreatesReport } from './types'

type StateReport = NonNullable<EntryMetadata['stateReport']>
type ReportedLocation = NonNullable<StateReport['newLocations']>[number]
type ReportedItem = NonNullable<StateReport['newItems']>[number]

// Both ways, with the same keys: the fallback reads a prior report's create lists back in as
// a TurnCreatesReport. Assignability alone passes an extra optional key on either side.
type SameKeys<A, B> = [Exclude<keyof A, keyof B> | Exclude<keyof B, keyof A>] extends [never]
  ? true
  : never
type Matches<A, B> = [A] extends [B] ? ([B] extends [A] ? SameKeys<A, B> : never) : never
type _CreatesMatch = [
  Matches<NewLocationReport, ReportedLocation>,
  Matches<NewItemReport, ReportedItem>,
]
const _createsChecks: _CreatesMatch = [true, true]
void _createsChecks

type BuildReportArgs = {
  layer: StateReport['layer']
  /** Post-substitution and post-planning: real entity ids, never placeholders or create handles. */
  block: ParsedStateBlock
  /** Widened to plain strings: a report read back from the column has already lost
   *  the `keyof ParsedStateBlock` narrowing, and the fallback re-supplies its own. */
  failures: { field: string; detail: string }[]
  /** The trailing block's own text. Retained only when a field failed. */
  raw?: string
  /** What apply.ts did with the emitted values. Absent when nothing was applied. */
  applied?: { worldTimeDelta: number; currentLocationRejected: boolean }
  /** What became of each create this turn. A list is written only when it holds an entry. */
  creates?: TurnCreatesReport
}

/**
 * Emitted vs. applied causes collapse onto one diff (entry-card.md → Emitted vs. applied).
 * `summary`/`retrievalQueries` omitted: they already live top-level on EntryMetadata.
 */
export function buildStateReport(args: BuildReportArgs): EntryMetadata['stateReport'] {
  const { layer, block, failures, raw, applied, creates } = args
  const newLocations = creates?.newLocations ?? []
  const newItems = creates?.newItems ?? []
  // Emptiness is judged on the block as emitted, summary included: a block carrying only
  // a summary reported state, and suppressing its report would badge the turn as one
  // where piggyback never ran. The create lists count too: the planner hands on the block
  // without them, so a block of creates alone arrives here empty.
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
    ...(block.transfers !== undefined ? { transfers: block.transfers } : {}),
    ...(newLocations.length > 0 ? { newLocations } : {}),
    ...(newItems.length > 0 ? { newItems } : {}),
    ...(failures.length > 0
      ? { failedFields: failures.map((f) => ({ field: f.field, detail: f.detail })) }
      : {}),
    // Redundant on the happy path; the only inspectable remnant when a parse failed.
    ...(failures.length > 0 && raw !== undefined ? { raw } : {}),
  }
}
