import { useCallback, useState } from 'react'

import { deleteUndoHint, type DeleteConfirmCopy } from '@/components/compounds/delete-confirm-copy'
import { deleteRow, ROW_DELETE_REJECTION, type DbCtx } from '@/lib/actions'
import type { Happening, Thread } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import {
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  threadsStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

export type PlotDeleteTarget =
  | { kind: 'thread'; row: Thread }
  | { kind: 'happening'; row: Happening }

type LinkCounts = { involvements: number; awareness: number }

export function plotDeleteCopy(target: PlotDeleteTarget, links: LinkCounts): DeleteConfirmCopy {
  if (target.kind === 'thread') {
    return {
      title: t('plot:delete.threadTitle', { name: target.row.title }),
      description: deleteUndoHint(),
      impacts: [],
      confirmLabel: t('plot:delete.confirmThread'),
    }
  }
  const impacts: string[] = []
  if (links.involvements > 0)
    impacts.push(t('plot:delete.involvements', { count: links.involvements }))
  if (links.awareness > 0) impacts.push(t('plot:delete.awareness', { count: links.awareness }))
  return {
    title: t('plot:delete.happeningTitle', { name: target.row.title }),
    description: deleteUndoHint(),
    impacts,
    confirmLabel: t('plot:delete.confirmHappening'),
  }
}

/** A happening's committed link-row counts, scoped to this branch and this row. Threads have none. */
export function plotLinkCounts(branchId: string, target: PlotDeleteTarget): LinkCounts {
  if (target.kind === 'thread') return { involvements: 0, awareness: 0 }
  const own = (row: { branchId: string; happeningId: string }) =>
    row.branchId === branchId && row.happeningId === target.row.id
  return {
    involvements: [...happeningInvolvementsStore.getInvolvements().values()].filter(own).length,
    awareness: [...happeningAwarenessStore.getAwareness().values()].filter(own).length,
  }
}

/**
 * Re-reads the target by id at proceed time (after a dirty-pane Save/Discard/Cancel resolves) —
 * a Save can rename the row or a concurrent write can remove it before the confirm opens.
 */
export function freshDeleteTarget(
  target: PlotDeleteTarget,
  threads: ReadonlyMap<string, Thread>,
  happenings: ReadonlyMap<string, Happening>,
): PlotDeleteTarget | null {
  if (target.kind === 'thread') {
    const row = threads.get(target.row.id)
    return row == null ? null : { kind: 'thread', row }
  }
  const row = happenings.get(target.row.id)
  return row == null ? null : { kind: 'happening', row }
}

/** A refused delete's user-facing text; the action's own reason is a developer string. */
export function plotDeleteRejectionText(code: string | undefined): string {
  return code === ROW_DELETE_REJECTION.inFlight
    ? t('plot:delete.inFlight')
    : t('plot:delete.failed')
}

/**
 * world.md → Delete: the confirm, then the row's delete with its cascade (C3). The row leaving
 * the store clears the selection; CTRL-Z in the reader brings it back.
 */
export function usePlotDelete(branchId: string, ctx: DbCtx, guard: (proceed: () => void) => void) {
  const [pending, setPending] = useState<{
    target: PlotDeleteTarget
    copy: DeleteConfirmCopy
  } | null>(null)

  const request = useCallback(
    (target: PlotDeleteTarget) =>
      guard(() => {
        const fresh = freshDeleteTarget(
          target,
          threadsStore.getThreads(),
          happeningsStore.getHappenings(),
        )
        if (fresh == null) return
        setPending({ target: fresh, copy: plotDeleteCopy(fresh, plotLinkCounts(branchId, fresh)) })
      }),
    [branchId, guard],
  )
  const cancel = useCallback(() => setPending(null), [])
  const confirm = useCallback(() => {
    if (pending == null) return
    const { target } = pending
    setPending(null)
    deleteRow(target.kind, branchId, target.row.id, ctx).then(
      (result) => {
        if (result.status === 'ok') toast.success(t('plot:delete.done', { name: target.row.title }))
        else toast.error(plotDeleteRejectionText(result.code))
      },
      (error: unknown) => {
        logger.error('app.plot_delete_failed', {
          branchId,
          id: target.row.id,
          error: error instanceof Error ? error.message : String(error),
        })
        toast.error(t('plot:delete.failed'))
      },
    )
  }, [pending, branchId, ctx])

  return { copy: pending?.copy ?? null, request, cancel, confirm }
}
