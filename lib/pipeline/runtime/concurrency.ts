import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { RunState } from '@/lib/stores'

import { getPipeline } from '../authoring/registry'
import { SUGGESTION_REFRESH_KIND } from '../definitions/suggestion-refresh'

export type StartDecision =
  | { kind: 'start' }
  | { kind: 'start-after-yields'; targets: readonly string[] }
  | { kind: 'blocked'; by: string }

// Kinds whose start must not land inside a prose reversal's wait->sweep window: both write
// an ai_classifier delta the sweep would replay over, and the choke-point guard only covers
// user-originated sources. Exported constants, not literals — nothing else ties this list
// to the definePipeline registrations.
const REVERSAL_BLOCKED: readonly string[] = [PERIODIC_CLASSIFIER_KIND, SUGGESTION_REFRESH_KIND]

// Consulted synchronously on runPipeline(kind) entry; reversalInProgress keeps a freshly
// scheduled run out of a prose-reversal's wait->sweep window.
export function checkConcurrencyContract(
  kind: string,
  currentRuns: ReadonlyMap<string, RunState>,
  reversalInProgress: boolean,
): StartDecision {
  if (reversalInProgress && REVERSAL_BLOCKED.includes(kind)) {
    return { kind: 'blocked', by: 'reversal' }
  }

  const blockedBy = getPipeline(kind).concurrencyPolicy.blockedBy ?? []
  for (const run of currentRuns.values()) {
    if (blockedBy.includes(run.kind)) return { kind: 'blocked', by: run.kind }
  }

  const targets: string[] = []
  for (const run of currentRuns.values()) {
    const yieldsTo = getPipeline(run.kind).concurrencyPolicy.yieldsTo ?? []
    if (yieldsTo.includes(kind)) targets.push(run.runId)
  }

  return targets.length > 0 ? { kind: 'start-after-yields', targets } : { kind: 'start' }
}
