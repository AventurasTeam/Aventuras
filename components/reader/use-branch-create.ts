import { useCallback, useRef, useState } from 'react'

import type { ReplaceStoryStack } from '@/hooks/use-replace-story-stack'
import {
  FORK_REFUSAL,
  forkBranch,
  showBranch,
  type ForkRefusal,
  type ForkResult,
  type ShowBranchResult,
} from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import {
  currentStoryStore,
  entriesStore,
  generationStore,
  isStoryBusy,
  readerHoldStore,
  type ReaderHoldToken,
} from '@/lib/stores'
import { messageOf } from '@/lib/thrown'
import { toast } from '@/lib/toast'

import type { BranchCreateModalProps, BranchCreatePhase } from './branch-create-modal'
import { refreshAfterFork } from './refresh-after-fork'
import { switchGateReason } from './switch-result-notice'

const ctx = { db, runInTransaction }

export type UseBranchCreateArgs = {
  storyId: string | null
  /** The reader's branch: the fork's parent. */
  branchId: string
  /** The reader's dispatch guard (a dispatch in flight or the reader held), read live. */
  isDispatchBlocked: () => boolean
  replaceStack: ReplaceStoryStack
  /** A pending embedder swap: Create disables while it lasts and re-enables as it ends. */
  swapPending: boolean
}

export type BranchCreate = {
  /** ReaderSurfaceProps['onBranch']: settles, never rejects. */
  onBranch: (entryId: string) => Promise<void>
  modal: BranchCreateModalProps | null
}

type ForkAt = { entryId: string; position: number }
type ForkRequest = { at: ForkAt; phase: BranchCreatePhase }

const IDLE: BranchCreatePhase = { kind: 'idle', line: null }
const PENDING: BranchCreatePhase = { kind: 'pending' }

// Outside the hook: the React Compiler bails on `finally`, and on `&&`/`?:`/`?.` inside a `try`.
async function holdingReader(
  branchId: string,
  run: (hold: ReaderHoldToken) => Promise<void>,
  onThrow: (error: unknown) => void,
): Promise<void> {
  const hold = readerHoldStore.take(branchId)
  try {
    await run(hold)
  } catch (error) {
    onThrow(error)
  } finally {
    readerHoldStore.release(hold)
  }
}

// branch-navigator.md → Branch creation — modal: forkBranch decides the refusal; this words it.
function refusalLine(
  refusal: ForkRefusal,
  storyId: string,
  at: { branchId: string; entryId: string },
): string {
  switch (refusal.code) {
    case FORK_REFUSAL.gated:
      return switchGateReason(generationStore.getTxState(), storyId)
    case FORK_REFUSAL.swapPending:
      return t('reader:actions.blockedWhileSwapping')
    case FORK_REFUSAL.unfinishedRun:
      return t('reader:branches.create.unfinishedRun')
    case FORK_REFUSAL.entryMissing:
    case FORK_REFUSAL.entrySystem:
      return t('reader:branches.create.entryGone')
    default:
      logger.warn('reader.branch_create_refused', {
        ...at,
        code: refusal.code,
        reason: refusal.reason,
      })
      return t('reader:branches.create.failed')
  }
}

/**
 * reader-composer.md → Per-entry actions, `⎇`: opens the creation modal on an entry and runs its
 * Create: the fork, the tail onto the new branch and the branch list's refresh (C8).
 */
export function useBranchCreate({
  storyId,
  branchId,
  isDispatchBlocked,
  replaceStack,
  swapPending,
}: UseBranchCreateArgs): BranchCreate {
  const [request, setRequest] = useState<ForkRequest | null>(null)
  // Read synchronously, so a second press returns before it reaches forkBranch.
  const pendingRef = useRef(false)

  // On native a rejection would re-reject inside the WebView, unlogged.
  const onBranch = useCallback(
    async (entryId: string): Promise<void> => {
      if (storyId == null) return
      try {
        if (isDispatchBlocked()) return
        const entry = entriesStore.getById(branchId, entryId)
        if (entry == null) {
          logger.warn('reader.branch_create_entry_missing', { branchId, entryId })
          return
        }
        setRequest({ at: { entryId, position: entry.position }, phase: IDLE })
      } catch (error) {
        logger.error('reader.branch_create_open_failed', {
          branchId,
          entryId,
          error: messageOf(error),
        })
        toast.error(t('reader:branches.create.failed'))
      }
    },
    [storyId, branchId, isDispatchBlocked],
  )

  const endPending = (line: string | null) => {
    pendingRef.current = false
    setRequest((open) => (open == null ? null : { at: open.at, phase: { kind: 'idle', line } }))
  }

  const close = () => {
    pendingRef.current = false
    setRequest(null)
  }

  const create = (sid: string, at: ForkAt, name: string): Promise<void> => {
    const logAt = { branchId, entryId: at.entryId }
    pendingRef.current = true
    setRequest({ at, phase: PENDING })
    let committed = false
    // C8: from the press to the navigation, a Send in the reader refuses as during a dispatch.
    return holdingReader(
      branchId,
      async (hold) => {
        // forkBranch's gate misses a run of the story without a hard gate, and a turn body.
        const txState = generationStore.getTxState()
        if (isStoryBusy(txState, sid, branchId) || generationStore.isTurnBodyActive(branchId)) {
          endPending(switchGateReason(txState, sid))
          return
        }
        let forked: ForkResult
        try {
          forked = await forkBranch(
            { parentBranchId: branchId, forkEntryId: at.entryId, name, makeCurrent: true },
            ctx,
          )
        } catch (error) {
          logger.error('reader.branch_create_failed', { ...logAt, error: messageOf(error) })
          endPending(t('reader:branches.create.failed'))
          return
        }
        if (forked.status === 'rejected') {
          endPending(refusalLine(forked, sid, logAt))
          return
        }
        committed = true
        const newBranchId = forked.branchId
        const open = currentStoryStore.getCurrentStory()
        // Left or switched since: the parent's reader is gone, so no screens to replace.
        if (open == null || open.storyId !== sid || open.branchId !== branchId) {
          logger.warn('reader.branch_create_not_opened', {
            branchId,
            newBranchId,
            cause: 'story-left',
          })
          refreshAfterFork(sid)
          close()
          return
        }
        let shown: ShowBranchResult
        try {
          shown = await showBranch({ storyId: sid, branchId: newBranchId, hold, replaceStack }, ctx)
        } catch (error) {
          // Its throws come after its reset: the reader navigated, and the new one's load reports.
          logger.error('reader.branch_create_show_threw', {
            branchId,
            newBranchId,
            error: messageOf(error),
          })
          refreshAfterFork(sid)
          close()
          return
        }
        refreshAfterFork(sid)
        if (shown.status !== 'navigation-blocked') return
        // showBranch put the pointer back here unless its restore and retry both failed (logged).
        logger.warn('reader.branch_create_not_opened', { branchId, newBranchId })
        close()
        toast.warning(t('reader:branches.create.notOpened', { name: name.trim() }))
      },
      (error) => {
        // Once committed the branch exists, so the modal closes rather than show the failed line.
        if (committed) close()
        else endPending(t('reader:branches.create.failed'))
        // After the reset: a log that throws too still leaves the modal live.
        logger.error('reader.branch_create_threw', { ...logAt, error: messageOf(error) })
      },
    )
  }

  const onCreate = (name: string): void => {
    if (storyId == null || request == null || pendingRef.current || swapPending) return
    void create(storyId, request.at, name)
  }

  const onCancel = (): void => {
    if (!pendingRef.current) close()
  }

  const modal: BranchCreateModalProps | null =
    request == null
      ? null
      : {
          entryPosition: request.at.position,
          phase: request.phase,
          createBlockedReason: swapPending ? t('reader:actions.blockedWhileSwapping') : undefined,
          onCreate,
          onCancel,
        }
  return { onBranch, modal }
}
