import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import {
  generationGateReason,
  selectStorySettingsGenerationRunKind,
} from '@/components/story-settings/generation-run'
import type { DeleteBranchRefusalCode, DeleteBranchResult } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { generationStore, isUserEditBlocked, type TxState } from '@/lib/stores'
import { attempt, messageOf } from '@/lib/thrown'
import { toast } from '@/lib/toast'

export type BranchDeleteTarget = { branchId: string; name: string; count: number }

/** The refusals that keep the confirm open, its line naming why. */
type HeldRefusal = Extract<DeleteBranchRefusalCode, 'gated' | 'swap-pending'>

/** The confirm's blocked line: the gate's or the swap's live reason, else the refusal its press met. */
export function branchDeleteBlockedReason(input: {
  txState: TxState
  storyId: string | undefined
  switchPaused: boolean
  swapPending: boolean
  refusal: HeldRefusal | null
}): string | undefined {
  // Hold-free: a held branch never blocks a delete, so no hold names the block.
  const gateReason = generationGateReason(
    true,
    selectStorySettingsGenerationRunKind(input.txState, input.storyId),
  )
  if (input.switchPaused) return gateReason
  if (input.swapPending) return t('reader:actions.blockedWhileSwapping')
  if (input.refusal === 'gated') return gateReason
  if (input.refusal === 'swap-pending') return t('reader:actions.blockedWhileSwapping')
  return undefined
}

/**
 * The reader's branch delete confirm (branch-navigator.md → Delete confirm): a row's count read
 * opens it; the delete closes it, or keeps it with a refusal's or a failure's line.
 */
export function useBranchDeleteConfirm({
  storyId,
  active,
  swapPending,
  count,
  remove,
  refresh,
  focusAfterDelete,
}: {
  storyId: string
  /** The reader has focus; losing it dismisses the confirm unless a delete is running. */
  active: boolean
  /** The reader's live swap state: a swap refusal lasts until this goes false. */
  swapPending: boolean
  count: (branchId: string) => Promise<number>
  remove: (branchId: string) => Promise<DeleteBranchResult>
  refresh: () => Promise<void>
  /** Where focus lands after a delete: the current branch's row. */
  focusAfterDelete: RefObject<unknown>
}): {
  target: BranchDeleteTarget | null
  pending: boolean
  failed: boolean
  /** Stable; its `.current` names the row only once a delete landed, else null. */
  returnFocusTo: RefObject<unknown>
  refusal: HeldRefusal | null
  open: (branchId: string, name: string) => Promise<void>
  dismiss: () => void
  confirm: () => Promise<void>
} {
  const [target, setTarget] = useState<BranchDeleteTarget | null>(null)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [refusal, setRefusal] = useState<HeldRefusal | null>(null)
  // Read synchronously, so a second press returns before it reaches the action.
  const pendingRef = useRef(false)
  const openRequest = useRef(0)
  // One ref for the confirm's life: FocusScope reads `.current` as the confirm unmounts, after the
  // render that cleared the target, so a prop set in that render would never reach it.
  const returnFocusTo = useRef<unknown>(null)
  const latest = useRef({ count, remove, refresh, focusAfterDelete, swapPending })
  useEffect(() => {
    latest.current = { count, remove, refresh, focusAfterDelete, swapPending }
  })
  // The reader saw a swap during the press: a refusal landing after that swap ended is stale.
  const swapSeenInPress = useRef(false)
  useEffect(() => {
    if (swapPending && pendingRef.current) swapSeenInPress.current = true
  }, [swapPending])

  // A gate refusal lasts while the gate holds: once it opens, `Delete branch` is live again.
  const gateClosed = generationStore.useGeneration((s) => isUserEditBlocked(s.txState))
  if (refusal === 'gated' && !gateClosed) setRefusal(null)
  // On the edge only: a marker the reader never saw pending keeps its refusal.
  const [swapSeen, setSwapSeen] = useState(swapPending)
  if (swapSeen !== swapPending) {
    setSwapSeen(swapPending)
    if (!swapPending && refusal === 'swap-pending') setRefusal(null)
  }

  const open = useCallback(
    async (branchId: string, name: string) => {
      if (pendingRef.current) return
      openRequest.current += 1
      const request = openRequest.current
      returnFocusTo.current = null
      const read = await attempt(() => latest.current.count(branchId))
      if (request !== openRequest.current) return
      if (!read.ok) {
        logger.error('app.branch_delete_count_failed', {
          storyId,
          branchId,
          error: messageOf(read.error),
        })
        toast.error(t('reader:branches.deleteReadFailed'))
        return
      }
      setFailed(false)
      setRefusal(null)
      setTarget({ branchId, name, count: read.value })
    },
    [storyId],
  )

  const confirm = useCallback(async () => {
    if (pendingRef.current || target == null) return
    const { branchId } = target
    pendingRef.current = true
    swapSeenInPress.current = latest.current.swapPending
    setPending(true)
    setFailed(false)
    setRefusal(null)
    returnFocusTo.current = null
    const removal = await attempt(() => latest.current.remove(branchId))
    pendingRef.current = false
    setPending(false)
    if (!removal.ok) {
      logger.error('app.branch_delete_threw', {
        storyId,
        branchId,
        error: messageOf(removal.error),
      })
      setFailed(true)
      return
    }
    const result = removal.value
    if (result.status === 'deleted') {
      // Before the clear: the pressed control left with its row, and the navigator stays open.
      returnFocusTo.current = latest.current.focusAfterDelete.current
      setTarget(null)
      return
    }
    if (result.code === 'gated' || result.code === 'swap-pending') {
      // The edge that clears a held refusal ran before this one landed.
      if (result.code === 'swap-pending' && swapSeenInPress.current && !latest.current.swapPending)
        return
      setRefusal(result.code)
      return
    }
    logger.warn('app.branch_delete_refused', { storyId, branchId, code: result.code })
    // A stale row: a re-read drops a gone branch, but a current one's row stays and needs a signal.
    if (result.code === 'current') toast.error(t('reader:branches.deleteConfirm.failed'))
    setTarget(null)
    void attempt(() => latest.current.refresh())
  }, [storyId, target])

  const dismiss = useCallback(() => {
    if (pendingRef.current) return
    openRequest.current += 1
    returnFocusTo.current = null
    setTarget(null)
    setFailed(false)
    setRefusal(null)
  }, [])

  // A Stack keeps the reader mounted under a pushed screen, and the confirm would reopen on
  // return. Re-checked as a delete ends: one that ran while focus left closes what it kept.
  useEffect(() => {
    if (!pending && !active) dismiss()
  }, [active, pending, dismiss])
  // An unmount renders no `active` false first, so it drops a pending read here.
  useEffect(
    () => () => {
      openRequest.current += 1
    },
    [],
  )

  return { target, pending, failed, returnFocusTo, refusal, open, dismiss, confirm }
}
