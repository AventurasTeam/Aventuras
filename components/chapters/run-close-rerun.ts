import { keepsConfirmOpen } from '@/components/reader/confirm-refusal'
import {
  describeCloseFailure,
  describePassFailure,
  retryRefusalText,
} from '@/components/reader/system-entry-actions'
import {
  CLOSE_RERUN_REFUSAL,
  describeDeltaReplayError,
  loadOpenStory,
  MANUAL_CLOSE_REFUSAL,
  startCloseRerun,
  STORY_ENTRY_REJECTION,
  type CloseRerunExpected,
  type CloseRerunPreview,
  type CloseRerunStart,
} from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  pipelineErrorDetail,
  type ChainEnd,
} from '@/lib/pipeline'
import { currentStoryStore, RERUN_HELD } from '@/lib/stores'
import { messageOf } from '@/lib/thrown'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

export type RerunNotice = { severity: 'info' | 'warning' | 'error'; message: string }

/** What the open confirm does once the start resolves; its notice, if any, has already shown. */
export type RerunStartStep =
  | { step: 'ended' }
  | { step: 'replace'; preview: CloseRerunPreview }
  | { step: 'keep-open' }
  | { step: 'refused' }

type Outcome = { step: RerunStartStep; notice: RerunNotice | null; logCode: string | null }

export function expectedOf(preview: CloseRerunPreview): CloseRerunExpected {
  const { shortcut } = preview
  return {
    shortcut:
      shortcut == null ? null : { targetEntryId: shortcut.targetEntryId, counts: shortcut.counts },
    reversal: preview.reversal,
  }
}

function firstLine(text: string | undefined): string | undefined {
  const line = text?.split('\n', 1)[0]?.trim()
  return line == null || line === '' ? undefined : line
}

/** The re-run's own end speaks here; a catch-up pass's end speaks as any pass's does. */
export function rerunEndNotice(end: ChainEnd, chapterNumber: number): RerunNotice | null {
  if (end.kind !== CHAPTER_CLOSE_KIND) return null
  const { result } = end
  if (result.outcome === 'completed') return null
  const number = chapterNumber
  if (result.closeUndone === true)
    return { severity: 'warning', message: t('chapters:rerunNotice.undone', { number }) }
  // Its writes wait for boot recovery, and the branch is held until then.
  if (result.outcome === 'failed' && result.unreversed === true)
    return { severity: 'error', message: t('chapters:rerunNotice.unreversed', { number }) }
  if (result.outcome === 'aborted')
    return { severity: 'info', message: t('chapters:rerunNotice.cancelled', { number }) }
  const reason = firstLine(pipelineErrorDetail(result.error))
  return {
    severity: 'warning',
    message:
      reason == null
        ? t('chapters:rerunNotice.failed', { number })
        : t('chapters:rerunNotice.failedWithReason', { number, reason }),
  }
}

const refusedWith = (message: string, logCode: string | null): Outcome => ({
  step: { step: 'refused' },
  notice: { severity: 'error', message },
  logCode,
})

const startFailed = (logCode: string): Outcome =>
  refusedWith(t('chapters:rerunNotice.startFailed'), logCode)

// A swap or a held branch outlasts the press, so the re-run says what the manual close does.
const LASTING_REFUSALS: ReadonlySet<string> = new Set([
  MANUAL_CLOSE_REFUSAL.swapPending,
  CLASSIFIER_HELD,
])

// As the delete and rollback confirms: it stays open and says why nothing ran; the host holds its
// actions while the story stays busy.
const keepOpen = (): Outcome => ({
  step: { step: 'keep-open' },
  notice: { severity: 'error', message: t('reader:actions.blockedWhileGenerating') },
  logCode: null,
})

/**
 * chapter-timeline.md → Re-run a close: what each result of `startCloseRerun` does to the confirm.
 */
export function rerunStartOutcome(start: CloseRerunStart, chapterNumber: number): Outcome {
  if ('result' in start)
    return { step: { step: 'ended' }, notice: rerunEndNotice(start, chapterNumber), logCode: null }
  if ('outcome' in start) {
    if (start.outcome === 'preflight-failed') {
      // A catch-up pass's settings failed it: the memory pass's own copy names its agent.
      const { error } = start
      const { content } =
        error.target === 'classifier'
          ? describePassFailure({ held: false, error })
          : describeCloseFailure(error)
      return {
        step: { step: 'refused' },
        notice: { severity: 'warning', message: content },
        logCode: 'preflight-failed',
      }
    }
    if (keepsConfirmOpen(start.blockedBy)) return keepOpen()
    if (start.blockedBy === RERUN_HELD)
      return refusedWith(t('generationGate.rerunHeld'), start.blockedBy)
    if (LASTING_REFUSALS.has(start.blockedBy))
      return refusedWith(
        retryRefusalText(start.blockedBy, 'reader:systemEntry.closeRetryBlocked'),
        start.blockedBy,
      )
    return startFailed(start.blockedBy)
  }
  // The start reads the preview again under its mark, so this one shape carries the fresh lines.
  if (start.code === STORY_ENTRY_REJECTION.countsChanged)
    return {
      step: { step: 'replace', preview: start.preview },
      notice: { severity: 'error', message: t('chapters:rerunNotice.countsChanged') },
      logCode: null,
    }
  if (keepsConfirmOpen(start.code)) return keepOpen()
  // The documented races (a close landed or came owed under the confirm): own copy, unlogged.
  if (start.code === CLOSE_RERUN_REFUSAL.notLatest)
    return refusedWith(t('chapters:rerunConfirm.notLatest'), null)
  if (start.code === CLOSE_RERUN_REFUSAL.closeOwed)
    return refusedWith(t('chapters:rerunConfirm.closeOwed'), null)
  return startFailed(start.code)
}

// As a cold open does; the start outlives the confirm, so it never re-publishes a branch left since.
async function resyncBranch(branchId: string, chapterId: string): Promise<boolean> {
  try {
    const result = await loadOpenStory(
      branchId,
      ctx,
      () => currentStoryStore.getCurrentStory()?.branchId === branchId,
    )
    if (result.status === 'ok' || result.status === 'cancelled') return true
    throw new Error(`branch re-hydration ${result.status}`)
  } catch (error) {
    logger.error('app.close_rerun_resync_failed', { branchId, chapterId, error: messageOf(error) })
    return false
  }
}

/** Starts the confirmed re-run and toasts its end; a run that ran resolves minutes later, after the
 * confirm has gone. */
export async function runCloseRerun(args: {
  branchId: string
  chapterId: string
  preview: CloseRerunPreview
  /** startCloseRerun's: the chain's first run reserved, so every refusal is past. */
  onStarted?: () => void
}): Promise<RerunStartStep> {
  const { branchId, chapterId, preview, onStarted } = args
  let start: CloseRerunStart
  try {
    start = await startCloseRerun(branchId, chapterId, expectedOf(preview), ctx, { onStarted })
  } catch (error) {
    // A replay failure's message is fixed: log its cause.
    const replay = describeDeltaReplayError(error)
    const detail = replay?.detail ?? messageOf(error)
    if (replay?.committed === true) {
      // The shortcut's rollback landed and only its store sync failed: the stores may hold its turns.
      logger.warn('app.close_rerun_sync_failed', { branchId, chapterId, error: detail })
      if (!(await resyncBranch(branchId, chapterId))) {
        toast.error(t('chapters:rerunNotice.resyncFailed'))
        return { step: 'refused' }
      }
    } else logger.error('app.close_rerun_start_threw', { branchId, chapterId, error: detail })
    toast.error(t('chapters:rerunNotice.startFailed'))
    return { step: 'refused' }
  }
  const { step, notice, logCode } = rerunStartOutcome(start, preview.chapterNumber)
  if (logCode != null)
    logger.warn('app.close_rerun_start_refused', { branchId, chapterId, code: logCode })
  if (notice != null) toast[notice.severity](notice.message)
  return step
}
