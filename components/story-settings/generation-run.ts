import { SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import type { RunState, TxState } from '@/lib/stores'

type StorySettingsGenerationRun = Pick<RunState, 'kind'> & {
  phase: 'generating-narrative' | 'closing-chapter' | 'refreshing-suggestions'
}

/**
 * Resolves the one run represented by Story Settings' universal status pill.
 * Narrative and chapter-close work take precedence over suggestion refresh so
 * the displayed action always cancels the run the pill is describing.
 */
export function selectStorySettingsGenerationRun(
  txState: TxState,
  storyId: string | undefined,
): StorySettingsGenerationRun | null {
  const storyRuns = [...txState.runs.values()].filter((run) => run.storyId === storyId)
  const hardGateRun =
    storyRuns.find(
      (candidate) =>
        candidate.gateBehavior === 'hard-gate' && candidate.kind !== SUGGESTION_REFRESH_KIND,
    ) ?? storyRuns.find((candidate) => candidate.gateBehavior === 'hard-gate')
  const run =
    hardGateRun ??
    storyRuns.find((candidate) => candidate.kind !== SUGGESTION_REFRESH_KIND) ??
    storyRuns[0]
  if (run == null) return null
  return {
    kind: run.kind,
    phase:
      run.kind === 'chapter-close'
        ? 'closing-chapter'
        : run.kind === SUGGESTION_REFRESH_KIND
          ? 'refreshing-suggestions'
          : 'generating-narrative',
  }
}

export type { StorySettingsGenerationRun }
