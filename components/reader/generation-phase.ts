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

// Kind wins over phase: the map above only covers per-turn, so a second
// foreground pipeline would otherwise borrow its labels and read "generating
// narrative" here while Story Settings reads the real one for the same run.
// Story Settings carries the matching entry in generation-run.ts.
const PILL_PHASE_BY_RUN_KIND: Record<string, GenerationPhase | undefined> = {
  'chapter-close': 'closing-chapter',
}

// A run holds the pill from the moment it enters txState, which is before phase
// 0 names itself (RunState.currentPhase starts empty). Blanking there would hand
// the slot to the sticky memory error mid-turn, so an unnamed phase keeps the
// generic label.
const UNMAPPED_TURN_PHASE: GenerationPhase = 'generating-narrative'

/**
 * Resolves the reader's status-pill phase from live run state. `turnKind` and
 * `turnPhase` are the `kind` and `currentPhase` of the foreground non-refresh
 * run on this branch, both null when no turn is running. Background runs are
 * excluded from them, so the periodic classifier reaches the pill through
 * `classifierRunning` instead.
 *
 * @returns The pill phase, or undefined when the pill should hide.
 */
export function readerPillPhase(input: {
  turnKind: string | null
  turnPhase: string | null
  refreshingSuggestions: boolean
  classifierRunning: boolean
}): GenerationPhase | undefined {
  if (input.turnPhase !== null)
    return (
      (input.turnKind === null ? undefined : PILL_PHASE_BY_RUN_KIND[input.turnKind]) ??
      PILL_PHASE_BY_TURN_PHASE[input.turnPhase] ??
      UNMAPPED_TURN_PHASE
    )
  if (input.refreshingSuggestions) return 'refreshing-suggestions'
  // Not 'classifying': that phase is the per-turn piggyback fallback, which does
  // hold the turn up. Same work, opposite answer to "can I keep writing?".
  return input.classifierRunning ? 'updating-memory' : undefined
}
