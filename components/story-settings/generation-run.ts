import type { GenerationPhase } from '@/components/compounds/generation-status-pill'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { t } from '@/lib/i18n'
import { SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import {
  backgroundClassifierRunId,
  generationStore,
  isBackgroundKind,
  isUserEditBlocked,
  type TxState,
} from '@/lib/stores'

type StorySettingsGenerationPhase =
  | 'generating-narrative'
  | 'closing-chapter'
  | 'refreshing-suggestions'

/**
 * Resolves the kind of the one run represented by Story Settings' universal
 * status pill. Narrative and chapter-close work take precedence over suggestion
 * refresh so the displayed action always cancels the run the pill is describing.
 *
 * @returns The run's kind, or null when no run covers the story.
 */
export function selectStorySettingsGenerationRunKind(
  txState: TxState,
  storyId: string | undefined,
): string | null {
  const storyRuns = [...txState.runs.values()].filter(
    (run) => run.storyId === storyId && !isBackgroundKind(run.kind),
  )
  const hardGateRun =
    storyRuns.find(
      (candidate) =>
        candidate.gateBehavior === 'hard-gate' && candidate.kind !== SUGGESTION_REFRESH_KIND,
    ) ?? storyRuns.find((candidate) => candidate.gateBehavior === 'hard-gate')
  const run =
    hardGateRun ??
    storyRuns.find((candidate) => candidate.kind !== SUGGESTION_REFRESH_KIND) ??
    storyRuns[0]
  return run?.kind ?? null
}

/** Why an in-story edit is blocked right now, or undefined when it isn't. */
export function generationGateReason(
  editBlocked: boolean,
  runKind: string | null,
): string | undefined {
  if (!editBlocked) return undefined
  return t(runKind === 'chapter-close' ? 'generationGate.chapterClose' : 'generationGate.inFlight')
}

/** The story's in-flight periodic-classifier run id, or null. */
export function selectStoryClassifierRunId(
  txState: TxState,
  storyId: string | undefined,
): string | null {
  for (const run of txState.runs.values())
    if (run.storyId === storyId && run.kind === PERIODIC_CLASSIFIER_KIND) return run.runId
  return null
}

/**
 * The run the story's status pill describes, the classifier pass in flight,
 * and why in-story edits are blocked. `branchId` keys the classifier pass to
 * that branch (World, Plot); omitted, it keys to the whole story (Story
 * Settings, which has no branch param).
 */
export function useStoryGenerationGate(storyId: string | undefined, branchId?: string) {
  const activeRunKind = generationStore.useGeneration((s) =>
    selectStorySettingsGenerationRunKind(s.txState, storyId),
  )
  const classifierRunId = generationStore.useGeneration((s) =>
    branchId != null
      ? backgroundClassifierRunId(s.txState, branchId)
      : selectStoryClassifierRunId(s.txState, storyId),
  )
  const editBlocked = generationStore.useGeneration((s) => isUserEditBlocked(s.txState))
  const gateReason = generationGateReason(editBlocked, activeRunKind)
  return { activeRunKind, editBlocked, gateReason, classifierRunId }
}

export function storySettingsGenerationPhase(kind: string): StorySettingsGenerationPhase {
  if (kind === 'chapter-close') return 'closing-chapter'
  if (kind === SUGGESTION_REFRESH_KIND) return 'refreshing-suggestions'
  return 'generating-narrative'
}

/** The status pill's phase: a foreground run's, else the classifier pass's non-blocking one. */
export function storyPillPhase(
  activeRunKind: string | null,
  classifierRunId: string | null,
): GenerationPhase | undefined {
  if (activeRunKind != null) return storySettingsGenerationPhase(activeRunKind)
  return classifierRunId != null ? 'updating-memory' : undefined
}

export type { StorySettingsGenerationPhase }
