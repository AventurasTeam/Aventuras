import { t } from '@/lib/i18n'
import { SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import { isBackgroundKind, type TxState } from '@/lib/stores'

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

export function storySettingsGenerationPhase(kind: string): StorySettingsGenerationPhase {
  if (kind === 'chapter-close') return 'closing-chapter'
  if (kind === SUGGESTION_REFRESH_KIND) return 'refreshing-suggestions'
  return 'generating-narrative'
}

export type { StorySettingsGenerationPhase }
