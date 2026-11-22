import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useSettleReread } from '@/hooks/use-settle-reread'
import {
  CLOSE_RERUN_REFUSAL,
  type CloseRerunPreview,
  type CloseRerunReadRefusal,
  type CloseRerunRefusalCode,
} from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { generationStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

export type CloseRerunConfirmTarget = { chapterId: string; preview: CloseRerunPreview }

type HeldTarget = CloseRerunConfirmTarget & { countedAtSettle: number }

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

function refusalCopy(
  code: CloseRerunRefusalCode,
):
  | 'chapters:rerunConfirm.notLatest'
  | 'chapters:rerunConfirm.closeOwed'
  | 'chapters:rerunConfirm.readFailed' {
  if (code === CLOSE_RERUN_REFUSAL.notLatest) return 'chapters:rerunConfirm.notLatest'
  if (code === CLOSE_RERUN_REFUSAL.closeOwed) return 'chapters:rerunConfirm.closeOwed'
  return 'chapters:rerunConfirm.readFailed'
}

// A missing close or chapter means a broken log or a stale card; `not-latest` and `close-owed`
// are races with copy of their own, and `integrity` logs where the set resolves.
function logReadRefusal(branchId: string, chapterId: string, code: CloseRerunRefusalCode): void {
  if (code === CLOSE_RERUN_REFUSAL.noClose || code === CLOSE_RERUN_REFUSAL.notFound)
    logger.warn('app.close_rerun_preview_refused', { branchId, chapterId, code })
}

// A start holds a pending mark through its shortcut, then pendingRerun through its chain: what
// settles under either is its own, and the start's result decides the confirm, not a re-read.
function startHolds(branchId: string): boolean {
  const txState = generationStore.getTxState()
  if (txState.pendingRerun.has(branchId)) return true
  for (const turn of txState.pendingTurns) if (turn.branchId === branchId) return true
  return false
}

/** The re-run confirm's preview (chapter-timeline.md → Re-run a close), re-read when a run settles
 * under it. */
export function useCloseRerunConfirm({
  branchId,
  active,
  pending,
  loadPreview,
}: {
  branchId: string
  /** The host holds the confirm's request; losing it dismisses as `dismiss` does. */
  active: boolean
  /**
   * The host's start is in flight, from the press, before any mark: its result decides the
   * confirm, so no re-read starts or lands.
   */
  pending: () => boolean
  loadPreview: (chapterId: string) => Promise<CloseRerunPreview | CloseRerunReadRefusal>
}): {
  target: CloseRerunConfirmTarget | null
  /** Resolves whether it holds the preview: false on a refusal, a throw or a superseded read. */
  open: (chapterId: string) => Promise<boolean>
  /** A start refused `counts-changed` with this fresh preview; nothing happens with none open. */
  replace: (preview: CloseRerunPreview) => void
  dismiss: () => void
} {
  const [held, setHeldState] = useState<HeldTarget | null>(null)
  // Written with the state, so a read landing before the next render sees a replacement.
  const heldNow = useRef<HeldTarget | null>(null)
  const setHeld = useCallback((next: HeldTarget | null) => {
    heldNow.current = next
    setHeldState(next)
  }, [])
  const openRequest = useRef(0)
  const latest = useRef({ loadPreview, pending })
  useEffect(() => {
    latest.current = { loadPreview, pending }
  })

  const open = useCallback(
    async (opening: string): Promise<boolean> => {
      openRequest.current += 1
      const request = openRequest.current
      const counted = generationStore.getSettleCount()
      const read = await attempt(() => latest.current.loadPreview(opening))
      if (request !== openRequest.current) return false
      if (!read.ok) {
        logger.error('app.close_rerun_preview_threw', {
          branchId,
          chapterId: opening,
          error: messageOf(read.error),
        })
        toast.error(t('chapters:rerunConfirm.readFailed'))
        return false
      }
      const result = read.value
      if ('status' in result) {
        logReadRefusal(branchId, opening, result.code)
        toast.error(t(refusalCopy(result.code)))
        return false
      }
      setHeld({ chapterId: opening, preview: result, countedAtSettle: counted })
      return true
    },
    [branchId, setHeld],
  )

  useSettleReread({
    target:
      held == null
        ? null
        : { key: `${branchId}:${held.chapterId}`, countedAtSettle: held.countedAtSettle },
    onSettle: (isLive) => {
      const startOwns = () => latest.current.pending() || startHolds(branchId)
      if (held == null || startOwns()) return
      const { chapterId, preview: shown } = held
      void attempt(() => latest.current.loadPreview(chapterId)).then((read) => {
        if (!isLive() || startOwns()) return
        if (!read.ok) {
          logger.error('app.close_rerun_recount_failed', {
            branchId,
            chapterId,
            error: messageOf(read.error),
          })
          return
        }
        // A preview the host replaced since (counts-changed) was read after this one began.
        const now = heldNow.current
        if (now?.chapterId !== chapterId || now.preview !== shown) return
        const result = read.value
        if ('status' in result) {
          logReadRefusal(branchId, chapterId, result.code)
          setHeld(null)
          toast.error(t(refusalCopy(result.code)))
          return
        }
        setHeld({ ...now, preview: result })
      })
    },
  })

  const replace = useCallback(
    (preview: CloseRerunPreview) => {
      const now = heldNow.current
      if (now != null) setHeld({ ...now, preview })
    },
    [setHeld],
  )

  const dismiss = useCallback(() => {
    openRequest.current += 1
    setHeld(null)
  }, [setHeld])

  useEffect(() => {
    if (!active) dismiss()
  }, [active, dismiss])
  // An unmount renders no `active` false first, so it drops a pending read here.
  useEffect(
    () => () => {
      openRequest.current += 1
    },
    [],
  )

  const target = useMemo(
    () => (held == null ? null : { chapterId: held.chapterId, preview: held.preview }),
    [held],
  )
  return { target, open, replace, dismiss }
}
