import { t } from '@/lib/i18n'
import type { RecoveredRun, RecoveryReport } from '@/lib/pipeline'

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

export function formatRecoveryReport(
  report: RecoveryReport,
  storyNames: RecoveryStoryNames,
): string {
  return report.reversed
    .map((run) => formatRun(run, run.storyId === null ? undefined : storyNames[run.storyId]))
    .join(' ')
}
