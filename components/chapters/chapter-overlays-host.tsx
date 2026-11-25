import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

import { readerHref } from '@/components/reader/reader-href'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { useReplaceStoryStack } from '@/hooks/use-replace-story-stack'
import { useSurfaceNavigate } from '@/hooks/use-surface-navigate'
import {
  getCloseRerunPreview,
  type CloseRerunPreview,
  type CloseRerunReadRefusal,
} from '@/lib/actions'
import { db, runInTransaction, type CloseReport, type Delta, type EntityKind } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { formatEntryRef } from '@/lib/entry-refs'
import {
  buildCloseReview,
  loadCloseDeltas,
  readCloseReport,
  readDeletedEntityKinds,
  type CloseReviewChange,
  type CloseReviewLookup,
  type CloseReviewNotApplied,
} from '@/lib/history'
import { t } from '@/lib/i18n'
import {
  chapterOverlaysStore,
  chaptersStore,
  currentStoryStore,
  entitiesStore,
  generationStore,
  happeningAwarenessStore,
  happeningsStore,
  isStoryBusy,
  loreStore,
  overlayChapter,
  type OpenStory,
  reviewWindowChapter,
  threadsStore,
  useCloseResultChapter,
  useRerunConfirmChapter,
  type RerunConfirmRequest,
  type StoreChapter,
} from '@/lib/stores'
import { messageOf } from '@/lib/thrown'
import { toast } from '@/lib/toast'

import { CloseChapterModal } from './close-chapter-modal'
import { CloseRerunConfirm } from './close-rerun-confirm'
import { reviewRowHref, type ReviewRowLiveness } from './review-row-href'
import { ReviewWindow, type ReviewWindowState } from './review-window'
import { runCloseRerun, runCloseRerunOnBranch, type RerunStartStep } from './run-close-rerun'
import { runManualClose } from './run-manual-close'
import { useCloseRerunConfirm } from './use-close-rerun-confirm'
import { useRerunDisabledReason } from './use-rerun-disabled-reason'
import { useReviewWindowPresence } from './use-review-window-presence'

const ctx = { db, runInTransaction }

// The window's chapter, not the bare request: a desktop exit reports before the prune clears it.
const reviewRequested = () => {
  const { review } = chapterOverlaysStore.getState()
  const openBranchId = currentStoryStore.getCurrentStory()?.branchId ?? null
  return reviewWindowChapter(review, chaptersStore.getChapters(openBranchId), openBranchId) != null
}

type ReviewSources = {
  report: CloseReport
  deltas: readonly Delta[]
  /** Each entity the report names, by its kind when the window read it: live, else its delete's. */
  kinds: ReadonlyMap<string, EntityKind>
}

function reportEntityIds(report: CloseReport): string[] {
  const ids = new Set<string>()
  for (const call of report.calls) {
    for (const row of call.rows) if (row.table === 'entities') ids.add(row.id)
    if (call.survivor?.table === 'entities') ids.add(call.survivor.id)
  }
  return [...ids]
}

async function readReviewSources(branchId: string, chapterId: string): Promise<ReviewSources> {
  try {
    const report = await readCloseReport(db, branchId, chapterId)
    if (report == null) throw new Error('close report missing')
    const kinds = new Map<string, EntityKind>()
    const absent: string[] = []
    for (const id of reportEntityIds(report)) {
      const kind = entitiesStore.getById(branchId, id)?.kind
      if (kind == null) absent.push(id)
      else kinds.set(id, kind)
    }
    const [deltas, deleted] = await Promise.all([
      loadCloseDeltas(db, branchId, chapterId, report.actionId, report.firstLogPosition),
      absent.length > 0 ? readDeletedEntityKinds(db, branchId, absent) : null,
    ])
    if (deleted != null) for (const [id, kind] of deleted) kinds.set(id, kind)
    return { report, deltas, kinds }
  } catch (error) {
    logger.error('app.close_review_read_failed', {
      branchId,
      chapterId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

// The open story's settings price the preview; a branch no longer open has nothing to read with.
async function readRerunPreview(
  branchId: string,
  chapterId: string,
): Promise<CloseRerunPreview | CloseRerunReadRefusal> {
  const open = currentStoryStore.getCurrentStory()
  if (open?.branchId !== branchId)
    throw new Error(`no open story on ${branchId} to preview a re-run with`)
  return getCloseRerunPreview(branchId, chapterId, open, ctx)
}

// Only a later chapter on the same branch is a close landing; a switch or story close is silent.
function closeLandedUnder(request: RerunConfirmRequest): boolean {
  const chapter = overlayChapter(chaptersStore.getById(request.branchId, request.chapterId))
  return chapter != null && chaptersStore.getLatest(request.branchId)?.id !== chapter.id
}

/**
 * C7's root host for the review window, close modal and re-run confirm. A row press or `Re-run…`
 * closes the window before the guard runs: a dirty pane is never bypassed, no dialog over it.
 */
export function ChapterOverlaysHost(): ReactElement | null {
  const review = chapterOverlaysStore.useOverlays((s) => s.review)
  const closeModal = chapterOverlaysStore.useOverlays((s) => s.closeModal)
  const closeResult = chapterOverlaysStore.useOverlays((s) => s.closeResult)
  const rerunConfirm = chapterOverlaysStore.useOverlays((s) => s.rerunConfirm)
  const openBranchId = currentStoryStore.useCurrentStory((open) => open?.branchId ?? null)
  const openSeq = currentStoryStore.useOpenSeq()
  const reviewChapter = chaptersStore.useChapters(openBranchId, (rows) =>
    reviewWindowChapter(review, rows, openBranchId),
  )
  const resultHolds =
    useCloseResultChapter(closeResult, { branchId: openBranchId, openSeq }) != null
  const rerunHolds = useRerunConfirmChapter(rerunConfirm, openBranchId) != null
  const presence = useReviewWindowPresence({
    requested: reviewChapter,
    isRequestedNow: reviewRequested,
    onClose: chapterOverlaysStore.closeReviewWindow,
  })
  const shown = presence.shown

  // Pruned, not hidden: a redo restores the same chapter id, and nothing may reopen by itself.
  useEffect(() => {
    if (review != null && reviewChapter == null) chapterOverlaysStore.closeReviewWindow()
  }, [review, reviewChapter])
  useEffect(() => {
    if (closeResult != null && !resultHolds) chapterOverlaysStore.clearCloseResult()
  }, [closeResult, resultHolds])
  // C7: a request for a branch the open story no longer shows is dropped, never shown later.
  const closeHolds = closeModal != null && closeModal.branchId === openBranchId
  useEffect(() => {
    if (closeModal != null && !closeHolds) chapterOverlaysStore.closeCloseModal()
  }, [closeModal, closeHolds])
  // The request whose start is in flight: that start refuses a close landing under it, and says so.
  const startingRef = useRef<RerunConfirmRequest | null>(null)
  const onStarting = useCallback((request: RerunConfirmRequest, starting: boolean) => {
    if (starting) startingRef.current = request
    else if (startingRef.current === request) startingRef.current = null
  }, [])
  // A pruned request's window stays closed: its chapter or branch went, and it may be another's
  // now. A close that landed under it says so, as the start's refusal would.
  useEffect(() => {
    if (rerunConfirm == null || rerunHolds) return
    chapterOverlaysStore.closeRerunConfirm({ reopen: false })
    if (startingRef.current !== rerunConfirm && closeLandedUnder(rerunConfirm))
      toast.error(t('chapters:rerunConfirm.notLatest'))
  }, [rerunConfirm, rerunHolds])

  // The modal shuts at once, since the close runs under the banner; the start outlives the body.
  const confirmClose = useCallback((branchId: string, endEntryId: string) => {
    chapterOverlaysStore.closeCloseModal()
    void runManualClose(branchId, endEntryId)
  }, [])

  if (shown == null && !closeHolds && !rerunHolds) return null
  return (
    <>
      {shown != null ? (
        <ReviewHost
          key={shown.id}
          chapter={shown}
          open={presence.open}
          onOpenChange={presence.onOpenChange}
          onExited={presence.onExited}
          onPresented={() => presence.onPresented(shown.id)}
        />
      ) : null}
      {closeHolds ? (
        <CloseChapterModal
          key={`${closeModal.branchId}:${closeModal.endEntryId ?? ''}`}
          request={closeModal}
          onConfirm={confirmClose}
        />
      ) : null}
      {rerunHolds && rerunConfirm != null ? (
        <RerunConfirmHost
          key={`${rerunConfirm.branchId}:${rerunConfirm.chapterId}`}
          request={rerunConfirm}
          onStarting={onStarting}
        />
      ) : null}
    </>
  )
}

/** Every read the window shows, resolved here: a gorhom Sheet's content sees no outer provider. */
function ReviewHost({
  chapter,
  open,
  onOpenChange,
  onExited,
  onPresented,
}: {
  chapter: StoreChapter
  open: boolean
  onOpenChange: (open: boolean) => void
  onExited: () => void
  onPresented: () => void
}): ReactElement {
  const { branchId, id: chapterId } = chapter
  const navigate = useSurfaceNavigate()
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const entryIndexRead = useEntryIndex(branchId)
  const entryIndex = entryIndexRead.index
  // Built before the index reads, a review cites raw entry ids and links no entry.
  const indexReady = entryIndexRead.ready
  const entities = entitiesStore.useEntities(branchId, (rows) => rows)
  const lore = loreStore.useLore(branchId, (rows) => rows)
  const threads = threadsStore.useThreads(branchId, (rows) => rows)
  const happenings = happeningsStore.useHappenings(branchId, (rows) => rows)
  const awareness = happeningAwarenessStore.useAwareness(branchId, (rows) => rows)
  const storyId = currentStoryStore.useCurrentStory((open) => open?.storyId)
  const rerunReason = useRerunDisabledReason(storyId, branchId)
  const latest = chaptersStore.useChapters(
    branchId,
    (rows) => chaptersStore.selectLatest(rows)?.id === chapterId,
  )
  const rerun = () =>
    chapterOverlaysStore.openRerunConfirm({ branchId, chapterId, fromReview: true })

  const sources = useQuery({
    queryKey: ['close-review', branchId, chapterId, settleCount],
    queryFn: () => readReviewSources(branchId, chapterId),
    // An exiting window reads nothing: its chapter may already be gone.
    enabled: open,
    // A settle re-reads under a new key; the window keeps the last review meanwhile.
    placeholderData: keepPreviousData,
  })
  const data = sources.data
  const kinds = data?.kinds

  const lookup = useMemo<CloseReviewLookup>(
    () => ({
      entityKind: (id) => entities.get(id)?.kind ?? kinds?.get(id),
      nameOf: (id) =>
        entities.get(id)?.name ??
        lore.get(id)?.title ??
        threads.get(id)?.title ??
        happenings.get(id)?.title,
      entryPosition: (id) => entryIndex.get(id)?.position,
    }),
    [entities, kinds, lore, threads, happenings, entryIndex],
  )

  const live = useMemo<ReviewRowLiveness>(
    () => ({
      isLive: (table, id) => {
        switch (table) {
          case 'lore':
            return lore.has(id)
          case 'entities':
            return entities.has(id)
          case 'threads':
            return threads.has(id)
          case 'happenings':
            return happenings.has(id)
          case 'happening_awareness':
            return awareness.has(id)
          default:
            return false
        }
      },
      entityKind: (id) => entities.get(id)?.kind,
      awarenessHappening: (id) => awareness.get(id)?.happeningId,
    }),
    [lore, entities, threads, happenings, awareness],
  )

  const review = useMemo(
    () => (data == null || !indexReady ? null : buildCloseReview(data.report, data.deltas, lookup)),
    [data, indexReady, lookup],
  )

  const press = useCallback(
    (href: string) => () => {
      // Drops a second press made during the window's exit.
      if (chapterOverlaysStore.getState().review == null) return
      // layout.md → Stacking: the window goes first, so the guard's dialog never sits over it.
      chapterOverlaysStore.closeReviewWindow()
      const surface = chapterOverlaysStore.currentSurface()
      if (surface == null) navigate(href)
      else surface.guard(() => surface.navigate(href))
    },
    [navigate],
  )

  const pressOf = (row: CloseReviewChange | CloseReviewNotApplied) => {
    const href = reviewRowHref(branchId, row.pressTo, live)
    return href == null ? undefined : press(href)
  }

  const entryLinkOf = (row: CloseReviewChange) => {
    if (row.entryId == null) return undefined
    const ref = entryIndex.get(row.entryId)
    if (ref == null) return undefined
    return {
      label: t('chapters:review.entryLink', { entry: formatEntryRef(ref.position) }),
      onPress: press(readerHref(branchId, row.entryId)),
    }
  }

  const sourcesFailed = sources.isError && !sources.isFetching
  const retry = () => {
    if (entryIndexRead.failed) entryIndexRead.retry()
    if (sourcesFailed) void sources.refetch()
  }
  const state: ReviewWindowState =
    review != null
      ? { status: 'ready', review }
      : sourcesFailed || entryIndexRead.failed
        ? { status: 'failed', onRetry: retry }
        : { status: 'loading' }

  return (
    <ReviewWindow
      open={open}
      onOpenChange={onOpenChange}
      onExited={onExited}
      onPresented={onPresented}
      onRerun={latest ? rerun : undefined}
      rerunDisabledReason={rerunReason}
      title={t('chapters:review.title', { number: chapter.sequenceNumber, title: chapter.title })}
      state={state}
      pressOf={pressOf}
      entryLinkOf={entryLinkOf}
    />
  )
}

/**
 * chapter-timeline.md → Re-run a close, mounted while its request holds. The confirm closes once
 * the chain holds the branch and `runCloseRerun` speaks for its end; the fork keeps it pending
 * until the new branch publishes and the prune closes it.
 */
function RerunConfirmHost({
  request,
  onStarting,
}: {
  request: RerunConfirmRequest
  /** Its start is in flight (true) or has resolved (false). */
  onStarting: (request: RerunConfirmRequest, starting: boolean) => void
}): ReactElement | null {
  const { branchId, chapterId } = request
  const storyId = currentStoryStore.useCurrentStory((open) => open?.storyId)
  const rerunReason = useRerunDisabledReason(storyId, branchId)
  // The turn body too: the fork's check refuses on it, and it outlives its mark with no run.
  const generating = generationStore.useGeneration(
    (s) =>
      storyId != null &&
      (isStoryBusy(s.txState, storyId, branchId) || generationStore.isTurnBodyActive(branchId)),
  )
  const replaceStack = useReplaceStoryStack()
  // Read synchronously, so a second press returns before it reaches the start or the fork.
  const pendingRef = useRef(false)
  const {
    target,
    open: openPreview,
    replace,
  } = useCloseRerunConfirm({
    branchId,
    active: true,
    pending: () => pendingRef.current,
    loadPreview: (id) => readRerunPreview(branchId, id),
  })
  // Through a ref, so the mount's one read never re-runs on a new callback identity.
  const openRef = useRef(openPreview)
  useEffect(() => {
    openRef.current = openPreview
  })
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    let live = true
    void openRef.current(chapterId).then((held) => {
      if (!live) return
      // A first read that opens nothing (the hook toasts why) ran nothing: a Cancel.
      if (held) setOpened(true)
      else chapterOverlaysStore.closeRerunConfirm({ reopen: true })
    })
    return () => {
      live = false
    }
  }, [chapterId])
  // A refused re-read closes it; the confirm showed, so the window stays closed.
  useEffect(() => {
    if (opened && target == null) chapterOverlaysStore.closeRerunConfirm({ reopen: false })
  }, [opened, target])

  const [pending, setPending] = useState(false)
  // An in-flight refusal holds the confirm actions while the story is busy: a pending turn's mark
  // can end with no run, and so with no settle.
  const [heldInFlight, setHeldInFlight] = useState(false)
  if (heldInFlight && !generating) setHeldInFlight(false)

  if (target == null) return null
  const { preview } = target

  // A request opened since, or already closed when the chain started, is not this one's.
  const closeOwn = () => {
    if (chapterOverlaysStore.getState().rerunConfirm === request)
      chapterOverlaysStore.closeRerunConfirm({ reopen: false })
  }

  // Read from the store, not the render: the rendered story lags a switch by a render.
  const begin = (): OpenStory | null => {
    const open = currentStoryStore.getCurrentStory()
    if (pendingRef.current || open == null || open.branchId !== branchId) return null
    pendingRef.current = true
    setPending(true)
    setHeldInFlight(false)
    onStarting(request, true)
    return open
  }

  const afterStart = (step: RerunStartStep) => {
    pendingRef.current = false
    setPending(false)
    switch (step.step) {
      case 'replace':
        replace(step.preview)
        return
      case 'keep-open':
        setHeldInFlight(true)
        return
      case 'ended':
      case 'refused':
        closeOwn()
    }
  }

  const confirm = () => {
    if (begin() == null) return
    // Once the chain's first run reserves every refusal is past, and the banner speaks.
    void runCloseRerun({ branchId, chapterId, preview, onStarted: closeOwn }).then((step) => {
      onStarting(request, false)
      afterStart(step)
    })
  }

  const confirmOnBranch = () => {
    const open = begin()
    if (open == null) return
    void runCloseRerunOnBranch({
      storyId: open.storyId,
      branchId,
      chapterId,
      preview,
      replaceStack,
      closeRequest: closeOwn,
    })
      .then((step) => {
        onStarting(request, false)
        // Past the commit it stays pending: the publish's prune or the sequence's close unmounts it.
        if (step.step !== 'forked') afterStart(step)
      })
      .catch((error: unknown) => {
        // A pending confirm can't be closed, so a throw past the sequence's own catches ends it.
        logger.error('app.close_rerun_on_branch_threw', {
          branchId,
          chapterId,
          error: messageOf(error),
        })
        onStarting(request, false)
        pendingRef.current = false
        setPending(false)
      })
  }

  const cancel = () => {
    if (!pendingRef.current) chapterOverlaysStore.closeRerunConfirm({ reopen: true })
  }

  const held = heldInFlight ? t('reader:actions.blockedWhileGenerating') : undefined
  return (
    <CloseRerunConfirm
      open
      preview={preview}
      blockedReason={rerunReason ?? held}
      pending={pending}
      onCancel={cancel}
      onConfirm={confirm}
      onConfirmOnBranch={confirmOnBranch}
    />
  )
}
