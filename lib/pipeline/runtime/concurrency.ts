import type { RunState } from '@/lib/stores'

import { getPipeline } from '../authoring/registry'

export type StartDecision =
  | { kind: 'start' }
  | { kind: 'start-after-yields'; targets: readonly string[] }
  | { kind: 'blocked'; by: string }

// Consulted synchronously on runPipeline(kind) entry. No pass or close may start inside a prose
// reversal's interrupt->sweep window: it would read prose the sweep is about to remove.
export function checkConcurrencyContract(
  kind: string,
  currentRuns: ReadonlyMap<string, RunState>,
  reversalInProgress: boolean,
): StartDecision {
  const pipeline = getPipeline(kind)
  if (pipeline.interruptible && reversalInProgress) return { kind: 'blocked', by: 'reversal' }

  const blockedBy = pipeline.concurrencyPolicy.blockedBy ?? []
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
