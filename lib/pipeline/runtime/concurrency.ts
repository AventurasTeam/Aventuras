import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { RunState } from '@/lib/stores'

import { getPipeline } from '../authoring/registry'

export type StartDecision =
  | { kind: 'start' }
  | { kind: 'start-after-yields'; targets: readonly string[] }
  | { kind: 'blocked'; by: string }

// Consulted synchronously on runPipeline(kind) entry. blockedBy rejects the start;
// yieldsTo aborts the running runs first; reversalInProgress keeps a freshly
// scheduled periodic-classifier out of a prose-reversal's wait->sweep window.
export function checkConcurrencyContract(
  kind: string,
  currentRuns: ReadonlyMap<string, RunState>,
  reversalInProgress: boolean,
): StartDecision {
  if (kind === PERIODIC_CLASSIFIER_KIND && reversalInProgress) {
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
