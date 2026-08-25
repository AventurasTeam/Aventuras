import { t } from '@/lib/i18n'
import type { RecoveredRun, RecoveryFailure, RecoveryReport } from '@/lib/pipeline'

export type RecoveryStoryNames = Readonly<Record<string, string>>

function formatRun(run: RecoveredRun, storyName: string | undefined): string {
  switch (run.kind) {
    case 'per-turn':
      return storyName
        ? t('crashRecovery.perTurnNamed', { storyName })
        : t('crashRecovery.perTurnUnnamed')
    case 'chapter-close':
      return storyName
        ? t('crashRecovery.chapterCloseNamed', { storyName })
        : t('crashRecovery.chapterCloseUnnamed')
    case 'periodic-classifier':
      return storyName
        ? t('crashRecovery.periodicClassifierNamed', { storyName })
        : t('crashRecovery.periodicClassifierUnnamed')
    default:
      return storyName
        ? t('crashRecovery.genericNamed', { storyName })
        : t('crashRecovery.genericUnnamed')
  }
}

// The classifier writes `state: 'running'` before it emits any delta, so an orphan
// of that kind which would not reverse is necessarily a branch boot held back —
// this is the one failure that can promise the pause rather than describe the fault.
function formatFailure(failure: RecoveryFailure, storyName: string | undefined): string {
  const paused = failure.kind === 'periodic-classifier'
  if (paused)
    return storyName
      ? t('crashRecovery.memoryPausedNamed', { storyName })
      : t('crashRecovery.memoryPausedUnnamed')
  return storyName
    ? t('crashRecovery.incompleteNamed', { storyName })
    : t('crashRecovery.incompleteUnnamed')
}

/** "Story recovered" over-claims when nothing could be reversed. */
export function formatRecoveryTitle(report: RecoveryReport): string {
  return report.reversed.length > 0 ? t('crashRecovery.title') : t('crashRecovery.titleIncomplete')
}

export function formatRecoveryReport(
  report: RecoveryReport,
  storyNames: RecoveryStoryNames,
): string {
  const named = (storyId: string | null) => (storyId === null ? undefined : storyNames[storyId])
  return [
    ...report.reversed.map((run) => formatRun(run, named(run.storyId))),
    ...report.failures.map((failure) => formatFailure(failure, named(failure.storyId))),
  ].join(' ')
}
