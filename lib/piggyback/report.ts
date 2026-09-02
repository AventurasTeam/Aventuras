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
}

/**
 * The turn's report as persisted. Records what the model EMITTED — `apply.ts`
 * separately decides what survives validation, and the divergence between the two is
 * what the reader's panel shows (docs/ui/patterns/entry-card.md → Emitted vs. applied).
 *
 * `summary` is deliberately not copied: it has a top-level home on EntryMetadata, and
 * a second copy here would give the reader two sources for one sentence.
 */
export function buildStateReport(args: BuildReportArgs): EntryMetadata['stateReport'] {
  const { layer, block, failures, raw } = args
  const { summary: _summary, ...reported } = block
  if (Object.keys(reported).length === 0 && failures.length === 0) return undefined

  return {
    layer,
    ...(reported.sceneEntities !== undefined ? { sceneEntities: reported.sceneEntities } : {}),
    ...(reported.currentLocation !== undefined
      ? { currentLocation: reported.currentLocation }
      : {}),
    ...(reported.worldTimeDelta !== undefined ? { worldTimeDelta: reported.worldTimeDelta } : {}),
    ...(reported.visualChanges !== undefined ? { visualChanges: reported.visualChanges } : {}),
    ...(reported.transfers !== undefined ? { transfers: reported.transfers } : {}),
    ...(failures.length > 0
      ? { failedFields: failures.map((f) => ({ field: f.field, detail: f.detail })) }
      : {}),
    // Redundant on the happy path; the only inspectable remnant when a parse failed.
    ...(failures.length > 0 && raw !== undefined ? { raw } : {}),
  }
}
