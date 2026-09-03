import type { EntryMetadata } from '@/lib/db'

import type { ParsedStateBlock } from './types'

type StateReport = NonNullable<EntryMetadata['stateReport']>

type BuildReportArgs = {
  layer: StateReport['layer']
  /** Post-substitution: real entity ids, not the prompt's placeholders. */
  block: ParsedStateBlock
  /** Widened to plain strings: a report read back from the column has already lost
   *  the `keyof ParsedStateBlock` narrowing, and the fallback re-supplies its own. */
  failures: { field: string; detail: string }[]
  /** The trailing block's own text. Retained only when a field failed. */
  raw?: string
  /** What apply.ts did with the emitted values. Absent when nothing was applied. */
  applied?: { worldTimeDelta: number; currentLocationRejected: boolean }
}

/**
 * The turn's report as persisted: what the model EMITTED, plus what `apply.ts` did with
 * it. Both are recorded because several causes collapse onto the same emitted-vs-current
 * difference (docs/ui/patterns/entry-card.md → Emitted vs. applied).
 *
 * `summary` is deliberately not copied: it has a top-level home on EntryMetadata, and
 * a second copy here would give the reader two sources for one sentence.
 */
export function buildStateReport(args: BuildReportArgs): EntryMetadata['stateReport'] {
  const { layer, block, failures, raw, applied } = args
  const { summary: _summary, ...reported } = block
  // Emptiness is judged on the block as emitted, summary included: a block carrying only
  // a summary reported state, and suppressing its report would badge the turn as one
  // where piggyback never ran.
  if (Object.keys(block).length === 0 && failures.length === 0) return undefined

  return {
    layer,
    ...(reported.sceneEntities !== undefined ? { sceneEntities: reported.sceneEntities } : {}),
    ...(reported.currentLocation !== undefined
      ? { currentLocation: reported.currentLocation }
      : {}),
    ...(reported.worldTimeDelta !== undefined ? { worldTimeDelta: reported.worldTimeDelta } : {}),
    ...(reported.worldTimeDelta !== undefined && applied !== undefined
      ? { worldTimeDeltaApplied: applied.worldTimeDelta }
      : {}),
    ...(applied?.currentLocationRejected === true
      ? { currentLocationRejected: true as const }
      : {}),
    ...(reported.visualChanges !== undefined ? { visualChanges: reported.visualChanges } : {}),
    ...(reported.transfers !== undefined ? { transfers: reported.transfers } : {}),
    ...(failures.length > 0
      ? { failedFields: failures.map((f) => ({ field: f.field, detail: f.detail })) }
      : {}),
    // Redundant on the happy path; the only inspectable remnant when a parse failed.
    ...(failures.length > 0 && raw !== undefined ? { raw } : {}),
  }
}
