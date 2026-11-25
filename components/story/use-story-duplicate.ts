import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  DuplicateBranch,
  DuplicateCheck,
  DuplicateRefusalCode,
  DuplicateStoryInput,
  DuplicateStoryResult,
} from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { attempt, messageOf } from '@/lib/thrown'
import { toast } from '@/lib/toast'

import type { DuplicateBranchOption, DuplicateDialogState } from './duplicate-story-dialog'

export type StoryDuplicateDialogModel = {
  /** Bumped per open; the host keys the dialog on it. */
  openSeq: number
  storyId: string
  sourceTitle: string
  branches: readonly DuplicateBranchOption[]
  currentBranchId: string
  state: DuplicateDialogState
}

const REFUSED_LINE = {
  'swap-pending': 'landing:duplicate.refused.swapPending',
  'branch-held': 'landing:duplicate.refused.unrecovered',
  'unfinished-run': 'landing:duplicate.refused.unrecovered',
  'run-registered': 'landing:duplicate.refused.running',
  missing: null,
  draft: null,
  empty: null,
} as const satisfies Record<DuplicateRefusalCode, string | null>

function refusedState(storyId: string, code: DuplicateRefusalCode): DuplicateDialogState {
  const line = REFUSED_LINE[code]
  if (line != null) return { kind: 'refused', reason: t(line) }
  // A stale list: the card offers no Duplicate on a draft, and the dialog blocks a blank name.
  logger.warn('app.story_duplicate_check_failed', { storyId, code })
  return { kind: 'failed' }
}

/** story-list.md → Duplicate a story: reads branches, checks the copy's, copies, calls `onDone`. */
export function useStoryDuplicate({
  focused,
  readBranches,
  check,
  duplicate,
  onDone,
}: {
  focused: boolean
  readBranches: (
    storyId: string,
  ) => Promise<{ branches: readonly DuplicateBranchOption[]; currentBranchId: string | null }>
  check: (storyId: string, branch: DuplicateBranch) => Promise<DuplicateCheck>
  duplicate: (input: DuplicateStoryInput) => Promise<DuplicateStoryResult>
  onDone: (copy: { storyId: string; title: string }) => void
}): {
  dialog: StoryDuplicateDialogModel | null
  open: (storyId: string, sourceTitle: string) => Promise<void>
  setBranch: (branch: DuplicateBranch) => void
  submit: (values: { title: string; branch: DuplicateBranch }) => Promise<void>
  dismiss: () => void
} {
  const [dialog, setDialogState] = useState<StoryDuplicateDialogModel | null>(null)
  // Callbacks decide on the ref: a second press can land before the render that shows the first.
  const dialogRef = useRef<StoryDuplicateDialogModel | null>(null)
  const openRequest = useRef(0)
  const checkRequest = useRef(0)
  const openSeq = useRef(0)
  const latest = useRef({ readBranches, check, duplicate, onDone })
  useEffect(() => {
    latest.current = { readBranches, check, duplicate, onDone }
  })

  const setDialog = useCallback((next: StoryDuplicateDialogModel | null) => {
    dialogRef.current = next
    setDialogState(next)
  }, [])

  // Lands only on the open it belongs to.
  const setState = useCallback(
    (seq: number, state: DuplicateDialogState) => {
      const current = dialogRef.current
      if (current?.openSeq !== seq) return
      setDialog({ ...current, state })
    },
    [setDialog],
  )

  const runCheck = useCallback(
    async (seq: number, storyId: string, branch: DuplicateBranch) => {
      checkRequest.current += 1
      const request = checkRequest.current
      const checked = await attempt(() => latest.current.check(storyId, branch))
      if (request !== checkRequest.current) return
      if (!checked.ok) {
        logger.error('app.story_duplicate_check_failed', {
          storyId,
          error: messageOf(checked.error),
        })
        setState(seq, { kind: 'failed' })
        return
      }
      const result = checked.value
      setState(seq, result.status === 'ok' ? { kind: 'ready' } : refusedState(storyId, result.code))
    },
    [setState],
  )

  const open = useCallback(
    async (storyId: string, sourceTitle: string) => {
      if (dialogRef.current?.state.kind === 'copying') return
      openRequest.current += 1
      const request = openRequest.current
      const read = await attempt(() => latest.current.readBranches(storyId))
      // A submit can start a copy during the read.
      if (request !== openRequest.current || dialogRef.current?.state.kind === 'copying') return
      if (!read.ok || read.value.branches.length === 0) {
        logger.error('app.story_duplicate_check_failed', {
          storyId,
          error: read.ok ? 'the story has no branch' : messageOf(read.error),
        })
        toast.error(t('landing:duplicate.failed'))
        return
      }
      const { branches, currentBranchId } = read.value
      const current = branches.find((branch) => branch.id === currentBranchId) ?? branches[0]
      openSeq.current += 1
      const seq = openSeq.current
      setDialog({
        openSeq: seq,
        storyId,
        sourceTitle,
        branches,
        currentBranchId: current.id,
        state: { kind: 'checking' },
      })
      await runCheck(seq, storyId, { branchId: current.id })
    },
    [runCheck, setDialog],
  )

  const setBranch = useCallback(
    (branch: DuplicateBranch) => {
      const current = dialogRef.current
      if (current == null || current.state.kind === 'copying') return
      setState(current.openSeq, { kind: 'checking' })
      void runCheck(current.openSeq, current.storyId, branch)
    },
    [runCheck, setState],
  )

  const submit = useCallback(
    async (values: { title: string; branch: DuplicateBranch }) => {
      const current = dialogRef.current
      if (current == null || (current.state.kind !== 'ready' && current.state.kind !== 'failed'))
        return
      const { openSeq: seq, storyId } = current
      setState(seq, { kind: 'copying' })
      const copied = await attempt(() =>
        latest.current.duplicate({ storyId, title: values.title, branch: values.branch }),
      )
      if (!copied.ok) {
        logger.error('app.story_duplicate_threw', { storyId, error: messageOf(copied.error) })
        setState(seq, { kind: 'failed' })
        return
      }
      const result = copied.value
      if (result.status === 'rejected') {
        setState(seq, refusedState(storyId, result.code))
        return
      }
      if (dialogRef.current?.openSeq === seq) setDialog(null)
      latest.current.onDone({ storyId: result.storyId, title: values.title.trim() })
    },
    [setDialog, setState],
  )

  const dismiss = useCallback(() => {
    if (dialogRef.current?.state.kind === 'copying') return
    openRequest.current += 1
    checkRequest.current += 1
    setDialog(null)
  }, [setDialog])

  const copying = dialog?.state.kind === 'copying'
  // A Stack keeps the list mounted under a pushed reader: a dialog left open would come back on
  // return with a check nothing kept current. Re-checked as a copy ends, which no dismissal stops.
  useEffect(() => {
    if (!focused && !copying) dismiss()
  }, [focused, copying, dismiss])
  // An unmount renders no `focused` false first, so it drops a read or a check in flight here.
  useEffect(
    () => () => {
      openRequest.current += 1
      checkRequest.current += 1
    },
    [],
  )

  return { dialog, open, setBranch, submit, dismiss }
}
