import type { GenerationPhase } from '@/components/compounds/generation-status-pill'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { t } from '@/lib/i18n'
import { PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import {
  awaitRunTerminal,
  generationStore,
  interruptMemoryRuns,
  isUserEditBlocked,
  type RunState,
  type TxState,
} from '@/lib/stores'

type StorySettingsGenerationPhase =
  | 'generating-narrative'
  | 'closing-chapter'
  | 'refreshing-suggestions'
  | 'updating-memory'

type PillScope = { storyId: string | undefined; branchId?: string }

/**
 * The one run the story's status pill describes, so its Cancel ends the run it names: a turn,
 * else a pass or a close (which own the pill over a refresh beside them), else another
 * hard-gate run, else a refresh. `branchId` narrows the pick to that branch of the story.
 */
function pillRun(txState: TxState, scope: PillScope): RunState | undefined {
  const runs = [...txState.runs.values()].filter(
    (run) =>
      run.storyId === scope.storyId && (scope.branchId == null || run.branchId === scope.branchId),
  )
  return (
    runs.find((run) => run.kind === PER_TURN_KIND) ??
    runs.find((run) => run.interruptible) ??
    runs.find((run) => run.gateBehavior === 'hard-gate' && run.kind !== SUGGESTION_REFRESH_KIND) ??
    runs.find((run) => run.kind === SUGGESTION_REFRESH_KIND)
  )
}

/** @returns The kind of the pill's run across the story, or null when no run covers it. */
export function selectStorySettingsGenerationRunKind(
  txState: TxState,
  storyId: string | undefined,
): string | null {
  return pillRun(txState, { storyId })?.kind ?? null
}

/**
 * Cancels the pill's run on the branch it runs on; a pass or a close, being interruptible, is
 * deferred to the next Send. Pass the `branchId` the screen gave `useStoryGenerationGate`, so
 * Cancel ends the run that pill names.
 */
export function cancelStoryPillRun(storyId: string | undefined, branchId?: string): void {
  const run = pillRun(generationStore.getTxState(), { storyId, branchId })
  if (run == null) return
  if (run.interruptible) void interruptMemoryRuns(run.branchId)
  else void awaitRunTerminal(run.kind, run.branchId, 'cancel')
}

/** Why an in-story edit is blocked right now, or undefined when it isn't. */
export function generationGateReason(
  editBlocked: boolean,
  runKind: string | null,
): string | undefined {
  if (!editBlocked) return undefined
  if (runKind === PERIODIC_CLASSIFIER_KIND) return t('generationGate.updatingMemory')
  if (runKind === 'chapter-close') return t('generationGate.chapterClose')
  if (runKind === SUGGESTION_REFRESH_KIND) return t('generationGate.suggestionRefresh')
  return t('generationGate.inFlight')
}

/**
 * The pill's run kind, whether it runs before the user's turn, and whether and why edits are
 * blocked. `branchId` picks the pill's run among that branch's runs (World, Plot); omitted,
 * among the story's (Story Settings).
 */
export function useStoryGenerationGate(
  storyId: string | undefined,
  branchId?: string,
): {
  activeRunKind: string | null
  editBlocked: boolean
  gateReason: string | undefined
  beforeTurn: boolean
} {
  const activeRunKind = generationStore.useGeneration(
    (s) => pillRun(s.txState, { storyId, branchId })?.kind ?? null,
  )
  const beforeTurn = generationStore.useGeneration(
    (s) => pillRun(s.txState, { storyId, branchId })?.beforeTurn ?? false,
  )
  const editBlocked = generationStore.useGeneration((s) => isUserEditBlocked(s.txState))
  const gateReason = generationGateReason(editBlocked, activeRunKind)
  return { activeRunKind, editBlocked, gateReason, beforeTurn }
}

export function storySettingsGenerationPhase(kind: string): StorySettingsGenerationPhase {
  if (kind === PERIODIC_CLASSIFIER_KIND) return 'updating-memory'
  if (kind === 'chapter-close') return 'closing-chapter'
  if (kind === SUGGESTION_REFRESH_KIND) return 'refreshing-suggestions'
  return 'generating-narrative'
}

/** The status pill's phase for the pill's run, or undefined when no run covers the screen. */
export function storyPillPhase(activeRunKind: string | null): GenerationPhase | undefined {
  return activeRunKind == null ? undefined : storySettingsGenerationPhase(activeRunKind)
}

export type { StorySettingsGenerationPhase }
