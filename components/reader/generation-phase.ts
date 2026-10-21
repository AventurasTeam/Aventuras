import type { GenerationPhase } from '@/components/compounds/generation-status-pill'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { PerTurnPhaseName } from '@/lib/pipeline'

// `satisfies` is the guard: a phase added to the per-turn pipeline widens
// PerTurnPhaseName and fails the build here until it has a label.
const PILL_PHASE_BY_TURN_PHASE: Record<string, GenerationPhase | undefined> = {
  'user-action-translation': 'generating-narrative',
  retrieval: 'recalling-memory',
  narrative: 'generating-narrative',
  'piggyback-fallback-classifier': 'classifying',
} satisfies Record<PerTurnPhaseName, GenerationPhase>

// Kind wins over phase: the map above only covers per-turn, so another pipeline
// would otherwise borrow its labels and read "generating narrative" here while
// Story Settings reads the real one for the same run. Story Settings carries the
// matching entries in generation-run.ts.
const PILL_PHASE_BY_RUN_KIND: Record<string, GenerationPhase | undefined> = {
  'chapter-close': 'closing-chapter',
  // Not 'classifying': that phase is the per-turn piggyback fallback, the turn's own work.
  [PERIODIC_CLASSIFIER_KIND]: 'updating-memory',
}

// A run holds the pill from the moment it enters txState, which is before phase
// 0 names itself (RunState.currentPhase starts empty). Blanking there would hand
// the slot to the sticky memory error mid-turn, so an unnamed phase keeps the
// generic label.
const UNMAPPED_TURN_PHASE: GenerationPhase = 'generating-narrative'

/**
 * Resolves the reader's status-pill phase from live run state. `turnKind` and
 * `turnPhase` are the `kind` and `currentPhase` of the run that owns the pill on
 * this branch, a turn else a pass, both null when neither runs. A pass owns the
 * pill over a refresh beside it, so a refresh shows only while they are null.
 *
 * @returns The pill phase, or undefined when the pill should hide.
 */
export function readerPillPhase(input: {
  turnKind: string | null
  turnPhase: string | null
  refreshingSuggestions: boolean
}): GenerationPhase | undefined {
  if (input.turnPhase !== null)
    return (
      (input.turnKind === null ? undefined : PILL_PHASE_BY_RUN_KIND[input.turnKind]) ??
      PILL_PHASE_BY_TURN_PHASE[input.turnPhase] ??
      UNMAPPED_TURN_PHASE
    )
  return input.refreshingSuggestions ? 'refreshing-suggestions' : undefined
}
