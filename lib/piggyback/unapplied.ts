import type { EntryMetadata } from '@/lib/db'

/** The `failedFields` entry the per-turn fallback appends when its own call fails. */
export const CLASSIFIER_FAILURE_FIELD = 'classifier'

/**
 * The model whose state this turn couldn't fully apply, or null (entry-card.md → State problems):
 * a dropped ref, a rejected location or condition, or a failed field nothing recovered. A clamped
 * delta is a correction, and a narrative failure the fallback recovered did apply.
 */
export function unappliedStateRole(
  report: EntryMetadata['stateReport'],
): 'narrative' | 'classifier' | null {
  if (report == null) return null
  const failed = report.failedFields ?? []
  const fallbackFailed = failed.some((f) => f.field === CLASSIFIER_FAILURE_FIELD)
  const fallbackWrote = report.layer === 'per_turn_classifier'
  const unrecovered = failed.length > 0 && (fallbackFailed || !fallbackWrote)
  const dropped = (report.droppedRefs?.length ?? 0) > 0
  const rejected =
    report.currentLocationRejected === true ||
    (report.conditions ?? []).some((c) => c.rejected === true)
  if (!unrecovered && !dropped && !rejected) return null
  return fallbackWrote || fallbackFailed || dropped ? 'classifier' : 'narrative'
}
