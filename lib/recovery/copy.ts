import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { t } from '@/lib/i18n'
import {
  PER_TURN_KIND,
  type BootRecoveryReport,
  type RecoveredRun,
  type RecoveryFailure,
} from '@/lib/pipeline'

export type RecoveryStoryNames = Readonly<Record<string, string>>

function formatRun(run: RecoveredRun, storyName: string | undefined): string {
  switch (run.kind) {
    case PER_TURN_KIND:
      return storyName
        ? t('crashRecovery.perTurnNamed', { storyName })
        : t('crashRecovery.perTurnUnnamed')
    case 'chapter-close':
      return storyName
        ? t('crashRecovery.chapterCloseNamed', { storyName })
        : t('crashRecovery.chapterCloseUnnamed')
    case PERIODIC_CLASSIFIER_KIND:
      return storyName
        ? t('crashRecovery.periodicClassifierNamed', { storyName })
        : t('crashRecovery.periodicClassifierUnnamed')
    default:
      return storyName
        ? t('crashRecovery.genericNamed', { storyName })
        : t('crashRecovery.genericUnnamed')
  }
}

// A pass failure holds its branch only while the boot left the branch `running` (Send refuses until
// a later boot frees it), so the copy promises a stop only then. An integrity refusal recurs every
// boot: no retry.
function formatFailure(
  failure: RecoveryFailure,
  storyName: string | undefined,
  isHeld: (storyId: string | null) => boolean,
): string {
  const held = failure.kind === PERIODIC_CLASSIFIER_KIND && isHeld(failure.storyId)
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

// A held story no pass failure explains: the reset threw or never ran.
const formatUnclearedHold = (storyName: string | undefined): string =>
  storyName
    ? t('crashRecovery.branchHeldUnclearedNamed', { storyName })
    : t('crashRecovery.branchHeldUnclearedUnnamed')

// With the read failed, every pass failure reads as held, the conservative answer.
const heldTest =
  (report: BootRecoveryReport) =>
  (storyId: string | null): boolean =>
    report.heldStoryIds === null || (storyId !== null && report.heldStoryIds.includes(storyId))

function unexplainedHolds(report: BootRecoveryReport): readonly string[] {
  const explained = new Set(
    report.failures.filter((f) => f.kind === PERIODIC_CLASSIFIER_KIND).map((f) => f.storyId),
  )
  return (report.heldStoryIds ?? []).filter((storyId) => !explained.has(storyId))
}

/** "Story recovered" over-claims while any orphan's writes are still on disk or a branch is held. */
export function formatRecoveryTitle(report: BootRecoveryReport): string {
  return report.reversed.length > 0 &&
    report.failures.length === 0 &&
    (report.heldStoryIds?.length ?? 0) === 0
    ? t('crashRecovery.title')
    : t('crashRecovery.titleIncomplete')
}

export function formatRecoveryReport(
  report: BootRecoveryReport,
  storyNames: RecoveryStoryNames,
): string {
  const named = (storyId: string | null) => (storyId === null ? undefined : storyNames[storyId])
  const isHeld = heldTest(report)
  return [
    ...report.reversed.map((run) => formatRun(run, named(run.storyId))),
    ...report.failures.map((failure) => formatFailure(failure, named(failure.storyId), isHeld)),
    ...unexplainedHolds(report).map((storyId) => formatUnclearedHold(named(storyId))),
  ].join(' ')
}
