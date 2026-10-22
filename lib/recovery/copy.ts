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

// The classifier writes `state: 'running'` before any delta, so an orphan of that kind that won't
// reverse holds its branch (Send refuses until a boot reverses it): the one failure that can
// promise its turns stop, not describe the fault. An integrity refusal recurs every boot: no retry.
function formatFailure(failure: RecoveryFailure, storyName: string | undefined): string {
  const held = failure.kind === 'periodic-classifier'
  const refused = failure.refusal !== null
  if (held && refused)
    return storyName
      ? t('crashRecovery.branchHeldRefusedNamed', { storyName })
      : t('crashRecovery.branchHeldRefusedUnnamed')
  if (held)
    return storyName
      ? t('crashRecovery.branchHeldNamed', { storyName })
      : t('crashRecovery.branchHeldUnnamed')
  if (refused)
    return storyName
      ? t('crashRecovery.incompleteRefusedNamed', { storyName })
      : t('crashRecovery.incompleteRefusedUnnamed')
  return storyName
    ? t('crashRecovery.incompleteNamed', { storyName })
    : t('crashRecovery.incompleteUnnamed')
}

/** "Story recovered" over-claims while any orphan's writes are still on disk. */
export function formatRecoveryTitle(report: RecoveryReport): string {
  return report.reversed.length > 0 && report.failures.length === 0
    ? t('crashRecovery.title')
    : t('crashRecovery.titleIncomplete')
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
