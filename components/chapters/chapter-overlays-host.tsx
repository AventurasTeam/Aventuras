import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, type ReactElement } from 'react'

import { readerHref } from '@/components/reader/reader-href'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { useSurfaceNavigate } from '@/hooks/use-surface-navigate'
import { db, type CloseReport, type Delta, type EntityKind } from '@/lib/db'
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
  closeResultChapter,
  currentStoryStore,
  entitiesStore,
  generationStore,
  happeningAwarenessStore,
  happeningsStore,
  loreStore,
  overlayChapter,
  threadsStore,
  type StoreChapter,
} from '@/lib/stores'

import { reviewRowHref, type ReviewRowLiveness } from './review-row-href'
import { ReviewWindow, type ReviewWindowState } from './review-window'

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
    const deltas = await loadCloseDeltas(db, branchId, chapterId, report.actionId)
    const kinds = new Map<string, EntityKind>()
    const absent: string[] = []
    for (const id of reportEntityIds(report)) {
      const kind = entitiesStore.getById(id)?.kind
      if (kind == null) absent.push(id)
      else kinds.set(id, kind)
    }
    if (absent.length > 0) {
      const deleted = await readDeletedEntityKinds(db, branchId, absent)
      for (const [id, kind] of deleted) kinds.set(id, kind)
    }
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

/**
 * C7's root host (the close modal joins in M5.10): a row press closes the window, then runs the
 * guard, so a dirty pane is never bypassed.
 */
export function ChapterOverlaysHost(): ReactElement | null {
  const review = chapterOverlaysStore.useOverlays((s) => s.review)
  const closeResult = chapterOverlaysStore.useOverlays((s) => s.closeResult)
  const openBranchId = currentStoryStore.useCurrentStory((open) => open?.branchId ?? null)
  const openSeq = currentStoryStore.useOpenSeq()
  const reviewChapter = chaptersStore.useChapters((rows) =>
    overlayChapter(review == null ? undefined : rows.get(review.chapterId), openBranchId),
  )
  const resultHolds = chaptersStore.useChapters(
    (rows) => closeResultChapter(closeResult, rows, { branchId: openBranchId, openSeq }) != null,
  )

  // Pruned, not hidden: a redo restores the same chapter id, and nothing may reopen by itself.
  useEffect(() => {
    if (review != null && reviewChapter == null) chapterOverlaysStore.closeReviewWindow()
  }, [review, reviewChapter])
  useEffect(() => {
    if (closeResult != null && !resultHolds) chapterOverlaysStore.clearCloseResult()
  }, [closeResult, resultHolds])

  if (reviewChapter == null) return null
  return <ReviewHost key={reviewChapter.id} chapter={reviewChapter} />
}

/** Every read the window shows, resolved here: a gorhom Sheet's content sees no outer provider. */
function ReviewHost({ chapter }: { chapter: StoreChapter }): ReactElement {
  const { branchId, id: chapterId } = chapter
  const navigate = useSurfaceNavigate()
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const entryIndexRead = useEntryIndex(branchId)
  const entryIndex = entryIndexRead.index
  // Built before the index reads, a review cites raw entry ids; a failed read shows it anyway.
  const indexPending = !entryIndexRead.ready && !entryIndexRead.failed
  const entities = entitiesStore.useEntities((rows) => rows)
  const lore = loreStore.useLore((rows) => rows)
  const threads = threadsStore.useThreads((rows) => rows)
  const happenings = happeningsStore.useHappenings((rows) => rows)
  const awareness = happeningAwarenessStore.useAwareness((rows) => rows)

  const sources = useQuery({
    queryKey: ['close-review', branchId, chapterId, settleCount],
    queryFn: () => readReviewSources(branchId, chapterId),
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
    () =>
      data == null || indexPending ? null : buildCloseReview(data.report, data.deltas, lookup),
    [data, indexPending, lookup],
  )

  const press = useCallback(
    (href: string) => () => {
      // Drops a second press made before the window unmounts.
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

  const state: ReviewWindowState =
    review != null
      ? { status: 'ready', review }
      : sources.isError && !sources.isFetching
        ? { status: 'failed', onRetry: () => void sources.refetch() }
        : { status: 'loading' }

  return (
    <ReviewWindow
      open
      onOpenChange={(next) => {
        if (!next) chapterOverlaysStore.closeReviewWindow()
      }}
      title={t('chapters:review.title', { number: chapter.sequenceNumber, title: chapter.title })}
      state={state}
      pressOf={pressOf}
      entryLinkOf={entryLinkOf}
    />
  )
}
