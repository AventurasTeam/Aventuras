import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'

import { chapterImpactLines } from '@/components/chapters/chapter-impact-lines'
import {
  readUndoImpact,
  readUndoTarget,
  redoLastAction,
  undoLastAction,
  type DbCtx,
  type RedoGroup,
  type UndoRejectionCode,
} from '@/lib/actions'
import type { Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { undoRedoStore } from '@/lib/stores'
import { toast } from '@/lib/toast'
import { describeRedoTarget, describeUndoGroup, type UndoDescription } from '@/lib/undo'
import { runAction } from '@/lib/utils'

import { UndoConfirm } from './undo-confirm'
import {
  deletedRowsOf,
  firstRowOf,
  liveUndoRow,
  snapshotRowsOf,
  undoConfirmRows,
  undoConfirmTitle,
  undoNames,
  undoTargetText,
  type UndoNames,
  type UnseenUndoDescription,
} from './undo-copy'

type Op = 'undo' | 'redo'
/** The keyboard's refusals are silent, by the native convention; every other origin's toast. */
type Origin = 'menu' | 'keyboard' | 'confirm' | 'notice'

type Refusal = { code: UndoRejectionCode; reason: string }

type Target = {
  actionId: string
  description: UndoDescription
  deltas: readonly Delta[]
  names: UndoNames
}

type Confirm = {
  target: Target & { description: UnseenUndoDescription }
  title: string
  lines: string[]
}

const NOTHING: Refusal = { code: 'nothing-to-apply', reason: 'nothing to apply' }

const CLOSE_KINDS: ReadonlySet<UndoDescription['kind']> = new Set(['close', 'rerun', 'keptClose'])

function redoNames(group: RedoGroup): UndoNames {
  return undoNames(firstRowOf(liveUndoRow, snapshotRowsOf(group.snapshots)))
}

/**
 * reader-composer.md → Undo and redo: each press names what it reverses, an unseen target confirms
 * first, and the undo reverses exactly the action it named. Every undo that lands shows a notice,
 * a newer one replacing the older, with Redo while the redo stack's top is what it undid.
 */
export function useReaderUndo({
  branchId,
  ctx,
  isFocused,
}: {
  branchId: string
  ctx: DbCtx
  isFocused: boolean
}): {
  undoLabel: string
  redoLabel: string | null
  onMenuOpenChange: (open: boolean) => void
  undo: (origin: 'menu' | 'keyboard') => void
  redo: (origin: 'menu' | 'keyboard') => void
  confirmOpen: boolean
  confirm: JSX.Element | null
} {
  const [menuTarget, setMenuTarget] = useState<Target | null>(null)
  const menuTargetRef = useRef<Target | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const busyRef = useRef(false)
  const noticeRef = useRef<string | null>(null)
  // Each open resolves afresh; a resolution an older open started is dropped.
  const resolveSeqRef = useRef(0)

  const showMenuTarget = useCallback((target: Target | null) => {
    menuTargetRef.current = target
    setMenuTarget(target)
  }, [])

  useEffect(() => {
    showMenuTarget(null)
    setConfirm(null)
  }, [branchId, showMenuTarget])

  // A confirm held on a screen that lost focus would undo unasked once it came back.
  useEffect(() => {
    if (!isFocused) setConfirm(null)
  }, [isFocused])

  const resolve = useCallback(async (): Promise<Target | null> => {
    const read = await readUndoTarget(branchId, ctx)
    if (read == null) return null
    return {
      actionId: read.actionId,
      description: describeUndoGroup(read.deltas),
      deltas: read.deltas,
      names: undoNames(firstRowOf(liveUndoRow, deletedRowsOf(read.deltas)), read.entryPositions),
    }
  }, [branchId, ctx])

  // Every refusal is logged; an integrity one is an error, never "Nothing to undo".
  const report = useCallback(
    (op: Op, refusal: Refusal, origin: Origin) => {
      const isUndo = op === 'undo'
      const fields = { branchId, code: refusal.code, reason: refusal.reason }
      if (refusal.code === 'integrity')
        logger.error(isUndo ? 'reader.undo_failed' : 'reader.redo_failed', fields)
      else logger.debug(isUndo ? 'reader.undo_rejected' : 'reader.redo_rejected', fields)
      if (origin === 'keyboard') return
      if (refusal.code === 'integrity')
        toast.error(t(isUndo ? 'reader:actions.undoFailed' : 'reader:actions.redoFailed'))
      else if (refusal.code === 'target-moved' && isUndo) toast.info(t('reader:undo.targetMoved'))
      else if (refusal.code === 'nothing-to-apply' || refusal.code === 'target-moved')
        toast.info(t(isUndo ? 'reader:actions.nothingToUndo' : 'reader:actions.nothingToRedo'))
      else if (refusal.code === 'gated') toast.info(t('reader:actions.blockedWhileGenerating'))
    },
    [branchId],
  )

  // A newer notice replaces the older, so a notice's Redo is always the redo stack's top.
  const announce = useCallback((message: string, redo?: () => void) => {
    if (noticeRef.current != null) toast.dismiss(noticeRef.current)
    noticeRef.current = toast.info(
      message,
      redo == null ? undefined : { action: { label: t('reader:undo.noticeRedo'), onPress: redo } },
    )
  }, [])

  const runRedo = useCallback(
    async (origin: Origin, expectedActionId?: string) => {
      const group = undoRedoStore.peekRedoGroup()
      if (group == null) {
        report('redo', NOTHING, origin)
        return
      }
      const description = describeRedoTarget(group)
      const names = redoNames(group)
      const result = await redoLastAction(branchId, ctx, {
        expectedActionId: expectedActionId ?? group.actionId,
      })
      if (result.status === 'rejected') report('redo', result, origin)
      else announce(undoTargetText(description, names, 'redoNotice'))
    },
    [announce, branchId, ctx, report],
  )

  const guarded = useCallback((op: Op, run: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    runAction(
      run().finally(() => {
        busyRef.current = false
      }),
      {
        event: op === 'redo' ? 'reader.redo_failed' : 'reader.undo_failed',
        toastMessage: t(op === 'redo' ? 'reader:actions.redoFailed' : 'reader:actions.undoFailed'),
      },
    )
  }, [])

  const runUndo = useCallback(
    async (target: Target, origin: Origin) => {
      const result = await undoLastAction(branchId, ctx, { expectedActionId: target.actionId })
      showMenuTarget(null)
      if (result.status === 'rejected') {
        report('undo', result, origin)
        return
      }
      // A re-run's undo can't be redone and clears the stack, so its notice offers no Redo.
      const redoable = undoRedoStore.peekRedoGroup()?.actionId === target.actionId
      announce(
        undoTargetText(target.description, target.names, 'notice'),
        redoable ? () => guarded('redo', () => runRedo('notice', target.actionId)) : undefined,
      )
    },
    [announce, branchId, ctx, guarded, report, runRedo, showMenuTarget],
  )

  const confirmLines = useCallback(
    async (target: Target): Promise<string[]> => {
      if (CLOSE_KINDS.has(target.description.kind)) {
        const impact = await readUndoImpact(branchId, target.actionId, ctx)
        const lines = impact == null ? [] : chapterImpactLines(impact)
        if (lines.length > 0) return lines
      }
      const rows = firstRowOf(liveUndoRow, deletedRowsOf(target.deltas))
      return undoConfirmRows(target.deltas, target.names, rows)
    },
    [branchId, ctx],
  )

  const undo = useCallback(
    (origin: 'menu' | 'keyboard') =>
      guarded('undo', async () => {
        const target = (origin === 'menu' ? menuTargetRef.current : null) ?? (await resolve())
        if (target == null) {
          report('undo', NOTHING, origin)
          return
        }
        const { description } = target
        if (description.seen) {
          await runUndo(target, origin)
          return
        }
        setConfirm({
          target: { ...target, description },
          title: undoConfirmTitle(description, target.names),
          lines: await confirmLines(target),
        })
      }),
    [confirmLines, guarded, report, resolve, runUndo],
  )

  const redo = useCallback(
    (origin: 'menu' | 'keyboard') => guarded('redo', () => runRedo(origin)),
    [guarded, runRedo],
  )

  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      const seq = ++resolveSeqRef.current
      showMenuTarget(null)
      if (!open) return
      resolve().then(
        (target) => {
          if (resolveSeqRef.current === seq) showMenuTarget(target)
        },
        (err: unknown) =>
          logger.error('reader.undo_target_read_failed', {
            branchId,
            error: err instanceof Error ? err.message : String(err),
          }),
      )
    },
    [branchId, resolve, showMenuTarget],
  )

  const redoTop = undoRedoStore.useUndoRedo((s) => s.redoStack.at(-1))
  const redoLabel = useMemo(
    () =>
      redoTop == null
        ? null
        : undoTargetText(describeRedoTarget(redoTop), redoNames(redoTop), 'redoMenu'),
    [redoTop],
  )
  const undoLabel =
    menuTarget == null
      ? t('reader:actions.undo')
      : undoTargetText(menuTarget.description, menuTarget.names, 'menu')

  const confirmUndo = useCallback(() => {
    if (confirm == null) return
    setConfirm(null)
    guarded('undo', () => runUndo(confirm.target, 'confirm'))
  }, [confirm, guarded, runUndo])
  const cancelConfirm = useCallback(() => setConfirm(null), [])

  const confirmElement =
    confirm != null && isFocused ? (
      <UndoConfirm
        open
        title={confirm.title}
        lines={confirm.lines}
        onConfirm={confirmUndo}
        onCancel={cancelConfirm}
      />
    ) : null

  return {
    undoLabel,
    redoLabel,
    onMenuOpenChange,
    undo,
    redo,
    confirmOpen: confirm != null,
    confirm: confirmElement,
  }
}
