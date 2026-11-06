import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

/** C2 → agent: the slot the close's tasks run in; with no task built yet it completes at once (M5). */
export async function* closeAgentPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  return { status: 'completed' }
}
