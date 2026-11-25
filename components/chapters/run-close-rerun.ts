import { keepsConfirmOpen } from '@/components/reader/confirm-refusal'
import {
  describeCloseFailure,
  describePassFailure,
  retryRefusalText,
} from '@/components/reader/system-entry-actions'
import type { ReplaceStoryStack } from '@/hooks/use-replace-story-stack'
import {
  checkCloseRerunParent,
  CLOSE_RERUN_REFUSAL,
  describeDeltaReplayError,
  FORK_REFUSAL,
  forkBranch,
  loadOpenStory,
  MANUAL_CLOSE_REFUSAL,
  showBranch,
  startCloseRerun,
  startCloseRerunOnFork,
  STORY_ENTRY_REJECTION,
  type CloseRerunExpected,
  type CloseRerunForkExpected,
  type CloseRerunForkPreview,
  type CloseRerunForkStart,
  type CloseRerunParentCheck,
  type CloseRerunPreview,
  type CloseRerunShortcut,
  type CloseRerunStart,
  type ForkRefusal,
  type ForkResult,
  type ShowBranchResult,
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
import {
  currentStoryStore,
  readerHoldStore,
  refreshBranches,
  RERUN_HELD,
  type ReaderHoldToken,
} from '@/lib/stores'
import { messageOf } from '@/lib/thrown'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

export type RerunNotice = { severity: 'info' | 'warning' | 'error'; message: string }

/** What the open confirm does on a refusal: nothing ran. */
export type RerunRefusalStep =
  | { step: 'replace'; preview: CloseRerunPreview }
  | { step: 'keep-open' }
  | { step: 'refused' }

/** What the open confirm does once the start resolves; its notice, if any, has already shown. */
export type RerunStartStep = { step: 'ended' } | RerunRefusalStep

type Outcome<Step extends RerunStartStep = RerunStartStep> = {
  step: Step
  notice: RerunNotice | null
  logCode: string | null
}

type Refusal = Outcome<RerunRefusalStep>

const shownShortcut = ({ targetEntryId, counts }: CloseRerunShortcut) => ({ targetEntryId, counts })

export function expectedOf(preview: CloseRerunPreview): CloseRerunExpected {
  const { shortcut, reversal } = preview
  return { shortcut: shortcut == null ? null : shownShortcut(shortcut), reversal }
}

function forkExpectedOf({ shortcut, reversal }: CloseRerunForkPreview): CloseRerunForkExpected {
  return { shortcut: shownShortcut(shortcut), reversal }
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

const refusedWith = (message: string, logCode: string | null): Refusal => ({
  step: { step: 'refused' },
  notice: { severity: 'error', message },
  logCode,
})

const startFailed = (logCode: string): Refusal =>
  refusedWith(t('chapters:rerunNotice.startFailed'), logCode)

// A swap or a held branch outlasts the press, so the re-run says what the manual close does.
const LASTING_REFUSALS: ReadonlySet<string> = new Set([
  MANUAL_CLOSE_REFUSAL.swapPending,
  CLASSIFIER_HELD,
])

// As the delete and rollback confirms: it stays open and says why nothing ran; the host holds its
// actions while the story stays busy.
const keepOpen = (): Refusal => ({
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
  return startRefusalOutcome(start)
}

// The parent check refuses as the in-place start does, and never ends a chain.
function startRefusalOutcome(start: Exclude<CloseRerunStart, ChainEnd>): Refusal {
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

type At = { branchId: string; chapterId: string }

function speak<Step extends RerunStartStep>(
  outcome: Outcome<Step>,
  kind: 'app.close_rerun_start_refused' | 'app.close_rerun_fork_refused',
  at: At,
): Step {
  if (outcome.logCode != null) logger.warn(kind, { ...at, code: outcome.logCode })
  if (outcome.notice != null) toast[outcome.notice.severity](outcome.notice.message)
  return outcome.step
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
  return speak(rerunStartOutcome(start, preview.chapterNumber), 'app.close_rerun_start_refused', {
    branchId,
    chapterId,
  })
}

/** A refusal before the fork commits, or `forked` once the sequence past it has run. */
export type RerunOnBranchStep = RerunRefusalStep | { step: 'forked' }

type RerunOnBranchArgs = Parameters<typeof runCloseRerunOnBranch>[0]

/** The new branch, and the name, N and chapter number the toasts past the commit read. */
type Forked = { newBranchId: string; name: string; position: number; number: number }

type ParentClear = Extract<CloseRerunParentCheck, { status: 'clear' }>

const isClear = (check: CloseRerunParentCheck): check is ParentClear =>
  'status' in check && check.status === 'clear'

// chapter-timeline.md → Re-run a close: the fork refuses before any write, onto the mounted confirm.
function forkRefusalOutcome(refusal: ForkRefusal): Refusal {
  switch (refusal.code) {
    case FORK_REFUSAL.gated:
      return keepOpen()
    case FORK_REFUSAL.swapPending:
      return refusedWith(
        retryRefusalText(MANUAL_CLOSE_REFUSAL.swapPending, 'reader:systemEntry.closeRetryBlocked'),
        null,
      )
    case FORK_REFUSAL.unfinishedRun:
      return refusedWith(t('chapters:rerunNotice.forkUnfinishedRun'), refusal.code)
    default:
      return startFailed(refusal.code)
  }
}

function forkThrew(at: At, step: 'check' | 'fork', error: unknown): RerunRefusalStep {
  logger.error('app.close_rerun_fork_threw', { ...at, step, error: messageOf(error) })
  toast.error(t('chapters:rerunNotice.startFailed'))
  return { step: 'refused' }
}

// No pending mark spans the check and the fork: forkBranch's gate counts every pending turn.
async function checkAndFork(args: RerunOnBranchArgs): Promise<RerunRefusalStep | Forked> {
  const { branchId, chapterId, preview } = args
  const at = { branchId, chapterId }
  let check: CloseRerunParentCheck
  try {
    check = await checkCloseRerunParent(branchId, chapterId, forkExpectedOf(preview), ctx)
  } catch (error) {
    return forkThrew(at, 'check', error)
  }
  if (!isClear(check)) return speak(startRefusalOutcome(check), 'app.close_rerun_start_refused', at)
  const { forkPoint } = check.preview.shortcut
  const number = preview.chapterNumber
  const name = t('chapters:rerunConfirm.autoName', { number })
  let result: ForkResult
  try {
    result = await forkBranch(
      { parentBranchId: branchId, forkEntryId: forkPoint.entryId, name, makeCurrent: true },
      ctx,
    )
  } catch (error) {
    return forkThrew(at, 'fork', error)
  }
  if (result.status === 'rejected')
    return speak(forkRefusalOutcome(result), 'app.close_rerun_fork_refused', at)
  return { newBranchId: result.branchId, name, position: forkPoint.position, number }
}

// C8: a failure here is logged, never surfaced; a reader that mounts re-reads the list. The store
// holds one story's rows: a refresh for a story no longer open would replace another story's.
function refreshAfterFork(storyId: string): void {
  if (currentStoryStore.getCurrentStory()?.storyId !== storyId) return
  void refreshBranches(db, storyId).catch((error: unknown) =>
    logger.warn('app.branches_refresh_failed', { storyId, error: messageOf(error) }),
  )
}

const forkedAt = (args: RerunOnBranchArgs, forked: Forked) => ({
  branchId: args.branchId,
  newBranchId: forked.newBranchId,
  chapterId: args.chapterId,
})

function warnStartFailed(forked: Forked): RerunOnBranchStep {
  toast.warning(
    t('chapters:rerunNotice.forkStartFailed', { name: forked.name, position: forked.position }),
  )
  return { step: 'forked' }
}

function forkStartFailed(
  args: RerunOnBranchArgs,
  forked: Forked,
  cause: string,
): RerunOnBranchStep {
  logger.warn('app.close_rerun_fork_start_failed', { ...forkedAt(args, forked), cause })
  return warnStartFailed(forked)
}

function threwAfterFork(
  args: RerunOnBranchArgs,
  forked: Forked,
  step: 'show' | 'start',
  error: unknown,
): RerunOnBranchStep {
  logger.error('app.close_rerun_fork_threw', {
    ...forkedAt(args, forked),
    step,
    error: messageOf(error),
  })
  return warnStartFailed(forked)
}

// The new branch may never have published, and only a publish's prune would close the request.
function closeUnshown(args: RerunOnBranchArgs): void {
  refreshAfterFork(args.storyId)
  args.closeRequest()
}

// The new branch was never shown: the user switches to it before retrying from its Timeline.
function notOpened(args: RerunOnBranchArgs, forked: Forked, cause?: string): RerunOnBranchStep {
  closeUnshown(args)
  logger.warn('app.close_rerun_fork_not_opened', {
    ...forkedAt(args, forked),
    ...(cause == null ? {} : { cause }),
  })
  toast.warning(
    t('chapters:rerunNotice.forkNotOpened', { name: forked.name, position: forked.position }),
  )
  return { step: 'forked' }
}

function refusalCause(start: Exclude<CloseRerunForkStart, ChainEnd>): string {
  if ('outcome' in start)
    return start.outcome === 'preflight-failed' ? start.outcome : start.blockedBy
  return start.code
}

async function startOnChild(args: RerunOnBranchArgs, forked: Forked): Promise<RerunOnBranchStep> {
  const { newBranchId, name, position, number } = forked
  let start: CloseRerunForkStart
  try {
    start = await startCloseRerunOnFork(newBranchId, args.chapterId, ctx, {
      onStarted: () => {
        toast.info(t('chapters:rerunNotice.forkStarted', { name, position, number }))
      },
    })
  } catch (error) {
    return threwAfterFork(args, forked, 'start', error)
  }
  if (!('result' in start)) return forkStartFailed(args, forked, refusalCause(start))
  const notice = rerunEndNotice(start, number)
  if (notice != null) toast[notice.severity](notice.message)
  return { step: 'forked' }
}

async function showThenStart(
  args: RerunOnBranchArgs,
  hold: ReaderHoldToken,
  forked: Forked,
): Promise<RerunOnBranchStep> {
  const { storyId, branchId, replaceStack } = args
  const open = currentStoryStore.getCurrentStory()
  // Left or switched since: the parent's reader is gone, so the tail has no screens to replace.
  if (open == null || open.storyId !== storyId || open.branchId !== branchId) {
    readerHoldStore.release(hold)
    return notOpened(args, forked, 'story-left')
  }
  let shown: ShowBranchResult
  try {
    shown = await showBranch(
      { storyId, branchId: forked.newBranchId, fromBranchId: branchId, hold, replaceStack },
      ctx,
    )
  } catch (error) {
    readerHoldStore.release(hold)
    closeUnshown(args)
    return threwAfterFork(args, forked, 'show', error)
  }
  // Idempotent: showBranch releases it on every path too.
  readerHoldStore.release(hold)
  // showBranch put the pointer back on the parent, or logged why not; the new branch stays.
  if (shown.status === 'navigation-blocked') return notOpened(args, forked)
  // Nothing published: the new branch isn't the open one, so a start would only refuse it.
  if (shown.status === 'shown-unloaded') {
    closeUnshown(args)
    return forkStartFailed(args, forked, shown.status)
  }
  refreshAfterFork(storyId)
  return startOnChild(args, forked)
}

/**
 * chapter-timeline.md → Re-run a close, Re-run on new branch: the check on the parent, the fork,
 * the tail, the refresh and the start on the new branch. Holds the reader from its call to the
 * navigation. Settles every refusal and failure itself; only a throw past its catches rejects.
 */
export async function runCloseRerunOnBranch(args: {
  storyId: string
  /** The parent: the branch the confirm opened on. */
  branchId: string
  chapterId: string
  preview: CloseRerunForkPreview
  replaceStack: ReplaceStoryStack
  /** Closes this confirm's request with `reopen: false`, if it is still the held one. */
  closeRequest: () => void
}): Promise<RerunOnBranchStep> {
  // Before the first await: a Send in the reader refuses from the press on (C8).
  const hold = readerHoldStore.take(args.branchId)
  try {
    const forked = await checkAndFork(args)
    if ('step' in forked) {
      readerHoldStore.release(hold)
      return forked
    }
    return await showThenStart(args, hold, forked)
  } finally {
    // A throw past the steps' own catches would otherwise freeze the parent reader.
    readerHoldStore.release(hold)
  }
}
