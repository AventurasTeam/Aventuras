import { useCallback, useEffect, useRef, useState } from 'react'

import {
  CHAPTER_DELETE_REFUSAL,
  DeltaReplayError,
  describeDeltaReplayError,
  type ChapterDeleteMode,
  type ChapterDeletePreview,
  type ChapterDeleteRefusal,
  type ChapterDeleteRefusalCode,
  type RemoveChapterResult,
} from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { chapterOverlaysStore, generationStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

export type ChapterDeleteConfirmTarget = {
  chapterId: string
  preview: ChapterDeletePreview
  countedAtSettle: number
}

export function chapterDeleteRefusalCopy(
  code: ChapterDeleteRefusalCode,
): 'chapters:deleteConfirm.notLatest' | 'chapters:deleteConfirm.failed' {
  return code === CHAPTER_DELETE_REFUSAL.notLatest
    ? 'chapters:deleteConfirm.notLatest'
    : 'chapters:deleteConfirm.failed'
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown }

// Outside the hook: React Compiler can't lower a try/catch whose block holds a value block.
async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A replay failure's message is fixed; what went wrong is in its cause.
function failureOf(error: unknown): string {
  return describeDeltaReplayError(error)?.detail ?? messageOf(error)
}

/**
 * The Timeline's delete confirm (chapter-timeline.md → Delete a chapter): the open chapter and
 * its preview, re-read whenever a run settles under it, as `useLiveRollbackCounts` recounts.
 */
export function useChapterDeleteConfirm({
  branchId,
  active,
  loadPreview,
  remove,
  resync,
}: {
  branchId: string
  /** The host screen has focus; losing it dismisses the confirm as `dismiss` does. */
  active: boolean
  loadPreview: (chapterId: string) => Promise<ChapterDeletePreview | ChapterDeleteRefusal>
  remove: (chapterId: string, mode: ChapterDeleteMode) => Promise<RemoveChapterResult>
  /** Re-hydrates the branch after a delete committed but its store sync failed. */
  resync: () => Promise<unknown>
}): {
  target: ChapterDeleteConfirmTarget | null
  /** A removal is running; the confirm's actions disable with it. */
  pending: boolean
  open: (chapterId: string) => Promise<void>
  dismiss: () => void
  confirm: (mode: ChapterDeleteMode) => Promise<void>
} {
  const [target, setTarget] = useState<ChapterDeleteConfirmTarget | null>(null)
  const [pending, setPending] = useState(false)
  // Read synchronously, so a second press returns before it reaches removeChapter's own refusal.
  const pendingRef = useRef(false)
  const openRequest = useRef(0)
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const reviewOpen = chapterOverlaysStore.useOverlays((s) => s.review != null)
  // The re-read effect's cleanup is what drops a stale read, so the host's fresh callbacks each
  // render must not re-run it: they ride in a ref.
  const latest = useRef({ loadPreview, remove, resync })
  useEffect(() => {
    latest.current = { loadPreview, remove, resync }
  })

  const chapterId = target?.chapterId ?? null
  const countedAtSettle = target?.countedAtSettle ?? null

  const open = useCallback(
    async (opening: string) => {
      // A committed delete's resync leaves its stale card live, and a read of it refuses.
      if (pendingRef.current) return
      openRequest.current += 1
      const request = openRequest.current
      const counted = generationStore.getSettleCount()
      const read = await attempt(() => latest.current.loadPreview(opening))
      if (request !== openRequest.current) return
      if (!read.ok) {
        logger.error('app.chapter_delete_preview_threw', {
          branchId,
          chapterId: opening,
          error: messageOf(read.error),
        })
        toast.error(t('chapters:deleteConfirm.failed'))
        return
      }
      const result = read.value
      if ('status' in result) {
        toast.error(t(chapterDeleteRefusalCopy(result.code)))
        return
      }
      setTarget({ chapterId: opening, preview: result, countedAtSettle: counted })
    },
    [branchId],
  )

  useEffect(() => {
    if (chapterId == null || countedAtSettle == null || settleCount <= countedAtSettle)
      return undefined
    // A removal's own reversal settles under it: its result closes the confirm, not a re-read.
    if (pendingRef.current) return undefined
    let live = true
    void attempt(() => latest.current.loadPreview(chapterId)).then((read) => {
      if (!live || pendingRef.current) return
      if (!read.ok) {
        logger.error('app.chapter_delete_recount_failed', {
          branchId,
          chapterId,
          error: messageOf(read.error),
        })
        return
      }
      const result = read.value
      if ('status' in result) {
        setTarget(null)
        toast.error(t(chapterDeleteRefusalCopy(result.code)))
        return
      }
      setTarget((prev) => (prev?.chapterId === chapterId ? { ...prev, preview: result } : prev))
    })
    return () => {
      live = false
    }
  }, [branchId, chapterId, countedAtSettle, settleCount])

  const confirm = useCallback(
    async (mode: ChapterDeleteMode) => {
      if (pendingRef.current || chapterId == null) return
      pendingRef.current = true
      setPending(true)
      const removal = await attempt(() => latest.current.remove(chapterId, mode))
      setTarget(null)
      if (removal.ok) {
        const result = removal.value
        if (result.status === 'rejected') toast.error(t(chapterDeleteRefusalCopy(result.code)))
      } else if (removal.error instanceof DeltaReplayError && removal.error.committed) {
        // The delete landed and only its store sync failed: a re-hydrate drops the stale card.
        logger.warn('app.chapter_delete_resynced', {
          branchId,
          chapterId,
          error: failureOf(removal.error),
        })
        const resynced = await attempt(() => latest.current.resync())
        if (!resynced.ok) {
          logger.error('app.chapter_delete_resync_failed', {
            branchId,
            chapterId,
            error: messageOf(resynced.error),
          })
          toast.error(t('chapters:deleteConfirm.resyncFailed'))
        }
      } else {
        logger.error('app.chapter_delete_threw', {
          branchId,
          chapterId,
          mode,
          error: failureOf(removal.error),
        })
        toast.error(t('chapters:deleteConfirm.failed'))
      }
      pendingRef.current = false
      setPending(false)
    },
    [branchId, chapterId],
  )

  const dismiss = useCallback(() => {
    if (pendingRef.current) return
    openRequest.current += 1
    setTarget(null)
  }, [])

  // A Stack keeps the Timeline mounted under a pushed screen: its reads would toast over that
  // screen, and the confirm would reopen on return with a preview nothing kept current. The
  // review window takes the screen the same way, and on phone its Sheet would cover the confirm.
  useEffect(() => {
    if (!active || reviewOpen) dismiss()
  }, [active, reviewOpen, dismiss])
  // An unmount renders no `active` false first, so it drops a pending read here; a removal's
  // continuation outlives the screen by design.
  useEffect(
    () => () => {
      openRequest.current += 1
    },
    [],
  )

  return { target, pending, open, dismiss, confirm }
}
