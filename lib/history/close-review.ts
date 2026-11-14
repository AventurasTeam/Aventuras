import type { CloseReport, CloseTask, Delta } from '@/lib/db'
import { t } from '@/lib/i18n'

import { closeReviewChanges } from './close-review-changes'
import { closeReviewNotApplied } from './close-review-not-applied'
import type { CloseReview, CloseReviewLookup, CloseReviewStopped } from './close-review-types'

const TASK_COPY = {
  happenings: 'chrome.memoryBanner.closeTask.happenings',
  lore: 'chrome.memoryBanner.closeTask.lore',
  identity: 'chrome.memoryBanner.closeTask.identity',
  threads: 'chrome.memoryBanner.closeTask.threads',
  upkeep: 'chrome.memoryBanner.closeTask.upkeep',
  lifecycle: 'chrome.memoryBanner.closeTask.lifecycle',
  awareness: 'chrome.memoryBanner.closeTask.awareness',
} as const satisfies Record<CloseTask, string>

export function closeTaskLabel(task: CloseTask): string {
  return t(TASK_COPY[task])
}

const STOP_COPY = {
  budget: 'chapters:review.stopped.budget',
  window: 'chapters:review.stopped.window',
  'cut-off': 'chapters:review.stopped.cut-off',
} as const satisfies Record<CloseReviewStopped['reason'], string>

/** chapter-close.md → When a task stops: one line per stopped task, its part unless chapter-wide. */
export function closeReviewStopped(report: CloseReport): CloseReview['stopped'] {
  return report.stopped.map(({ task, part, reason }) => {
    const copy = { task: closeTaskLabel(task), reason: t(STOP_COPY[reason]) }
    return {
      task,
      part,
      reason,
      text:
        part === 0
          ? t('chapters:review.stopped.lineNoPart', copy)
          : t('chapters:review.stopped.line', { ...copy, part }),
    }
  })
}

/** chapter-timeline.md → Review window: what a close changed, read from its report and deltas. */
export function buildCloseReview(
  report: CloseReport,
  deltas: readonly Delta[],
  lookup: CloseReviewLookup,
): CloseReview {
  return {
    stopped: closeReviewStopped(report),
    noToolCalls: report.noToolCalls,
    notApplied: closeReviewNotApplied(report, lookup),
    changes: closeReviewChanges(report, deltas, lookup),
  }
}
