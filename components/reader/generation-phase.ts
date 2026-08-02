import type { GenerationPhase } from '@/components/compounds/generation-status-pill'
import type { PerTurnPhaseName } from '@/lib/pipeline'

// `satisfies` is the guard: a phase added to the per-turn pipeline widens
// PerTurnPhaseName and fails the build here until it has a label.
const PILL_PHASE_BY_TURN_PHASE: Record<string, GenerationPhase | undefined> = {
  'user-action-translation': 'generating-narrative',
  retrieval: 'recalling-memory',
  narrative: 'generating-narrative',
  'piggyback-fallback-classifier': 'classifying',
} satisfies Record<PerTurnPhaseName, GenerationPhase>

// A run holds the pill from the moment it enters txState, which is before phase
// 0 names itself (RunState.currentPhase starts empty) and covers kinds whose
// phases this map doesn't know. Blanking there would hand the slot to the
// sticky memory error mid-turn, so an unmapped name keeps the generic label.
const UNMAPPED_TURN_PHASE: GenerationPhase = 'generating-narrative'

/**
 * Resolves the reader's status-pill phase from live run state. `turnPhase` is
 * the `currentPhase` of the non-refresh run on this branch, or null when no
 * turn is running.
 *
 * @returns The pill phase, or undefined when the pill should hide.
 */
export function readerPillPhase(input: {
  turnPhase: string | null
  refreshingSuggestions: boolean
}): GenerationPhase | undefined {
  if (input.turnPhase !== null)
    return PILL_PHASE_BY_TURN_PHASE[input.turnPhase] ?? UNMAPPED_TURN_PHASE
  return input.refreshingSuggestions ? 'refreshing-suggestions' : undefined
}
