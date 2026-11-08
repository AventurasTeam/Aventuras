import type { GroupOutcome, PipelineAction } from '@/lib/actions/types'

import type { PhaseEmittedEvent } from '../types'

/**
 * Writes `actions` as one group anchored on `entryId`; `yield*` it from a phase. Evaluates to the
 * orchestrator's `GroupOutcome`, so a refusal is a value for the phase to read, never a throw.
 */
export function* emitDeltaGroup(
  actions: readonly PipelineAction[],
  entryId: string,
): Generator<PhaseEmittedEvent, GroupOutcome, GroupOutcome | undefined> {
  const outcome = yield { type: 'delta_group_emitted', actions, entryId }
  if (outcome === undefined)
    throw new Error('delta_group_emitted: the orchestrator sent no outcome back')
  return outcome
}
