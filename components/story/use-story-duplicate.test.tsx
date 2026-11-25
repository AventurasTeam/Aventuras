// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DuplicateBranch,
  DuplicateCheck,
  DuplicateStoryInput,
  DuplicateStoryResult,
} from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import { toast } from '@/lib/toast'

// Type-only: the dialog renders RN-Web chrome the unit project can't load.
import type { DuplicateBranchOption } from './duplicate-story-dialog'
import { useStoryDuplicate } from './use-story-duplicate'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))

type BranchRead = {
  branches: readonly DuplicateBranchOption[]
  currentBranchId: string | null
}
type ReadBranches = (storyId: string) => Promise<BranchRead>
type Check = (storyId: string, branch: DuplicateBranch) => Promise<DuplicateCheck>
type Duplicate = (input: DuplicateStoryInput) => Promise<DuplicateStoryResult>
type OnDone = (copy: { storyId: string; title: string }) => void
type Hook = ReturnType<typeof useStoryDuplicate>
type Props = { focused: boolean; blocked: boolean }
type Values = { title: string; branch: DuplicateBranch }

// The locale's lines, written out: reading them through t() would pass on any string.
const FAILED = "Couldn't duplicate the story."
const SWAP_PENDING = 'An embedding model change is pending on this story.'
const UNRECOVERED = "A branch being copied has an interrupted update the app hasn't recovered."
const RUNNING = 'A run is still going on this story.'

const MAIN: DuplicateBranchOption = { id: 'br_main', name: 'main' }
const FORK: DuplicateBranchOption = { id: 'br_fork', name: 'fork' }
const OK: DuplicateCheck = { status: 'ok' }
const COPIED: DuplicateStoryResult = { status: 'duplicated', storyId: 'story_copy' }
const SIDE: DuplicateBranchOption = { id: 'br_side', name: 'side' }
const VALUES: Values = { title: 'Copy', branch: { branchId: FORK.id } }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Runs every step an open, a check or a copy awaits, inside act.
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function setup() {
  const readBranches = vi.fn<ReadBranches>(async () => ({
    branches: [MAIN, FORK],
    currentBranchId: FORK.id,
  }))
  const check = vi.fn<Check>(async () => OK)
  const duplicate = vi.fn<Duplicate>(async () => COPIED)
  const onDone = vi.fn<OnDone>()
  const hook = renderHook(
    (props: Props) => useStoryDuplicate({ ...props, readBranches, check, duplicate, onDone }),
    { initialProps: { focused: true, blocked: false } },
  )
  return { ...hook, readBranches, check, duplicate, onDone }
}

async function openOn(result: { current: Hook }, storyId = 'story_a', sourceTitle = 'Aria') {
  await act(async () => {
    await result.current.open(storyId, sourceTitle)
  })
}

async function submitOn(result: { current: Hook }, values: Values = VALUES) {
  await act(async () => {
    await result.current.submit(values)
  })
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
  vi.spyOn(logger, 'error').mockImplementation(() => {})
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useStoryDuplicate: opening', () => {
  it('mounts no dialog until the branch read lands, then checks the current branch', async () => {
    const { result, readBranches, check } = setup()
    const read = deferred<BranchRead>()
    readBranches.mockReturnValueOnce(read.promise)
    const gate = deferred<DuplicateCheck>()
    check.mockReturnValueOnce(gate.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.open('story_a', 'Aria')
    })
    expect(readBranches).toHaveBeenCalledWith('story_a')
    expect(result.current.dialog).toBeNull()

    read.resolve({ branches: [MAIN, FORK], currentBranchId: FORK.id })
    await flush()
    expect(result.current.dialog).toEqual({
      openSeq: expect.any(Number),
      storyId: 'story_a',
      sourceTitle: 'Aria',
      branches: { current: FORK, others: [MAIN] },
      branch: { branchId: FORK.id },
      state: { kind: 'checking' },
    })
    expect(check).toHaveBeenCalledWith('story_a', { branchId: FORK.id })

    await act(async () => {
      gate.resolve(OK)
      await opening
    })
    expect(result.current.dialog?.state).toEqual({ kind: 'ready' })
  })

  it('logs, toasts and opens nothing when the branch read throws', async () => {
    const { result, readBranches, check } = setup()
    readBranches.mockRejectedValueOnce(new Error('db locked'))
    await openOn(result)
    expect(result.current.dialog).toBeNull()
    expect(check).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(FAILED)
    expect(logger.error).toHaveBeenCalledWith('app.story_duplicate_read_failed', {
      storyId: 'story_a',
      error: 'db locked',
    })
  })

  it('logs, toasts and opens nothing when the story has no branch', async () => {
    const { result, readBranches, check } = setup()
    readBranches.mockResolvedValueOnce({ branches: [], currentBranchId: null })
    await openOn(result)
    expect(result.current.dialog).toBeNull()
    expect(check).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(FAILED)
    expect(logger.error).toHaveBeenCalledWith(
      'app.story_duplicate_read_failed',
      expect.objectContaining({ storyId: 'story_a' }),
    )
  })

  it.each([
    ['names no listed branch', 'br_gone'],
    ['is null', null],
  ])('falls back to the first branch when the pointer %s', async (_, pointer) => {
    const { result, readBranches, check } = setup()
    readBranches.mockResolvedValueOnce({ branches: [MAIN, FORK, SIDE], currentBranchId: pointer })
    await openOn(result)
    expect(result.current.dialog?.branches).toEqual({ current: MAIN, others: [FORK, SIDE] })
    expect(result.current.dialog?.branch).toEqual({ branchId: MAIN.id })
    expect(check).toHaveBeenCalledWith('story_a', { branchId: MAIN.id })
  })

  it('mounts only the latest of two opens whose reads land out of order', async () => {
    const { result, readBranches, check } = setup()
    const first = deferred<BranchRead>()
    const second = deferred<BranchRead>()
    readBranches.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let a: Promise<void> = Promise.resolve()
    let b: Promise<void> = Promise.resolve()
    act(() => {
      a = result.current.open('story_a', 'Aria')
      b = result.current.open('story_b', 'Bran')
    })
    await act(async () => {
      second.resolve({ branches: [MAIN], currentBranchId: MAIN.id })
      await b
    })
    await act(async () => {
      first.resolve({ branches: [MAIN, FORK], currentBranchId: FORK.id })
      await a
    })
    expect(result.current.dialog).toMatchObject({
      storyId: 'story_b',
      sourceTitle: 'Bran',
      branches: { current: MAIN, others: [] },
    })
    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith('story_b', { branchId: MAIN.id })
  })

  it('gives each open a new openSeq', async () => {
    const { result } = setup()
    await openOn(result)
    const first = result.current.dialog?.openSeq
    expect(first).toEqual(expect.any(Number))
    act(() => {
      result.current.dismiss()
    })
    expect(result.current.dialog).toBeNull()
    await openOn(result)
    expect(result.current.dialog?.openSeq).toBeGreaterThan(first as number)
  })

  it('opens nothing when the list loses focus during the branch read', async () => {
    const { result, rerender, readBranches, check } = setup()
    const read = deferred<BranchRead>()
    readBranches.mockReturnValueOnce(read.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.open('story_a', 'Aria')
    })
    rerender({ focused: false, blocked: false })
    await act(async () => {
      read.resolve({ branches: [MAIN], currentBranchId: MAIN.id })
      await opening
    })
    expect(result.current.dialog).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('opens nothing when another list overlay is up as the branch read lands', async () => {
    const { result, rerender, readBranches, check } = setup()
    const read = deferred<BranchRead>()
    readBranches.mockReturnValueOnce(read.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.open('story_a', 'Aria')
    })
    rerender({ focused: true, blocked: true })
    await act(async () => {
      read.resolve({ branches: [MAIN], currentBranchId: MAIN.id })
      await opening
    })
    expect(result.current.dialog).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('checks nothing when the list unmounts during the branch read', async () => {
    const { result, unmount, readBranches, check } = setup()
    const read = deferred<BranchRead>()
    readBranches.mockReturnValueOnce(read.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.open('story_a', 'Aria')
    })
    unmount()
    read.resolve({ branches: [MAIN], currentBranchId: MAIN.id })
    await opening
    expect(check).not.toHaveBeenCalled()
  })
})

describe('useStoryDuplicate: checking', () => {
  it.each([
    ['swap-pending', SWAP_PENDING],
    ['branch-held', UNRECOVERED],
    ['unfinished-run', UNRECOVERED],
    ['run-registered', RUNNING],
  ] as const)('shows the %s refusal as its line', async (code, reason) => {
    const { result, check } = setup()
    check.mockResolvedValueOnce({ status: 'rejected', code })
    await openOn(result)
    expect(result.current.dialog?.state).toEqual({ kind: 'refused', reason })
  })

  it.each(['missing', 'draft'] as const)(
    'shows the failure for a %s refusal and logs it',
    async (code) => {
      const { result, check } = setup()
      check.mockResolvedValueOnce({ status: 'rejected', code })
      await openOn(result)
      expect(result.current.dialog?.state).toEqual({ kind: 'failed' })
      expect(logger.warn).toHaveBeenCalledWith('app.story_duplicate_refused', {
        storyId: 'story_a',
        code,
      })
    },
  )

  it('logs a thrown check and shows the failure', async () => {
    const { result, check } = setup()
    check.mockRejectedValueOnce(new Error('db locked'))
    await openOn(result)
    expect(result.current.dialog?.state).toEqual({ kind: 'failed' })
    expect(logger.error).toHaveBeenCalledWith('app.story_duplicate_check_failed', {
      storyId: 'story_a',
      error: 'db locked',
    })
  })

  it('re-checks a changed branch, and a slower earlier check never lands over the later', async () => {
    const { result, check } = setup()
    await openOn(result)
    const earlier = deferred<DuplicateCheck>()
    const later = deferred<DuplicateCheck>()
    check.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise)

    act(() => {
      result.current.setBranch('all')
    })
    expect(result.current.dialog?.state).toEqual({ kind: 'checking' })
    act(() => {
      result.current.setBranch({ branchId: MAIN.id })
    })
    expect(check).toHaveBeenNthCalledWith(2, 'story_a', 'all')
    expect(check).toHaveBeenNthCalledWith(3, 'story_a', { branchId: MAIN.id })

    later.resolve(OK)
    await flush()
    expect(result.current.dialog?.state).toEqual({ kind: 'ready' })
    earlier.resolve({ status: 'rejected', code: 'unfinished-run' })
    await flush()
    expect(result.current.dialog?.state).toEqual({ kind: 'ready' })
  })

  it('drops a check that lands after a dismiss', async () => {
    const { result, check } = setup()
    const gate = deferred<DuplicateCheck>()
    check.mockReturnValueOnce(gate.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.open('story_a', 'Aria')
    })
    await flush()
    expect(result.current.dialog?.state).toEqual({ kind: 'checking' })
    act(() => {
      result.current.dismiss()
    })
    await act(async () => {
      gate.resolve({ status: 'rejected', code: 'swap-pending' })
      await opening
    })
    expect(result.current.dialog).toBeNull()
  })
})

describe('useStoryDuplicate: submitting', () => {
  it('copies once for two submits while copying, and ignores opens and branch changes', async () => {
    const { result, readBranches, check, duplicate } = setup()
    await openOn(result)
    const copy = deferred<DuplicateStoryResult>()
    duplicate.mockReturnValueOnce(copy.promise)
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.submit(VALUES)
    })
    expect(result.current.dialog?.state).toEqual({ kind: 'copying' })

    await submitOn(result)
    act(() => {
      result.current.setBranch({ branchId: MAIN.id })
    })
    await openOn(result, 'story_b', 'Bran')
    expect(duplicate).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledTimes(1)
    expect(readBranches).toHaveBeenCalledTimes(1)
    expect(result.current.dialog?.state).toEqual({ kind: 'copying' })
    expect(result.current.dialog?.branch).toEqual({ branchId: FORK.id })

    await act(async () => {
      copy.resolve(COPIED)
      await first
    })
    expect(duplicate).toHaveBeenCalledTimes(1)
  })

  it('keeps a copying dialog over an open whose branch read lands during the copy', async () => {
    const { result, readBranches, check, duplicate, onDone } = setup()
    await openOn(result)
    const read = deferred<BranchRead>()
    readBranches.mockReturnValueOnce(read.promise)
    const copy = deferred<DuplicateStoryResult>()
    duplicate.mockReturnValueOnce(copy.promise)
    let opening: Promise<void> = Promise.resolve()
    let copying: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.open('story_b', 'Bran')
    })
    act(() => {
      copying = result.current.submit(VALUES)
    })
    await act(async () => {
      read.resolve({ branches: [MAIN], currentBranchId: MAIN.id })
      await opening
    })
    expect(result.current.dialog).toMatchObject({
      storyId: 'story_a',
      sourceTitle: 'Aria',
      state: { kind: 'copying' },
    })
    expect(check).toHaveBeenCalledTimes(1)

    await act(async () => {
      copy.resolve(COPIED)
      await copying
    })
    expect(result.current.dialog).toBeNull()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith({ storyId: 'story_copy', title: 'Copy' })
  })

  it('copies once for two submits in one tick, before any render shows the first', async () => {
    const { result, duplicate, onDone } = setup()
    await openOn(result)
    await act(async () => {
      const first = result.current.submit(VALUES)
      const second = result.current.submit(VALUES)
      await Promise.all([first, second])
    })
    expect(duplicate).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('closes on a copy and reports it under the stored, trimmed title', async () => {
    const { result, duplicate, onDone } = setup()
    await openOn(result)
    await submitOn(result, { title: '  Ashes  ', branch: { branchId: FORK.id } })
    expect(duplicate).toHaveBeenCalledWith({
      storyId: 'story_a',
      title: '  Ashes  ',
      branch: { branchId: FORK.id },
    })
    expect(result.current.dialog).toBeNull()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith({ storyId: 'story_copy', title: 'Ashes' })
  })

  it('copies the selection its check approved', async () => {
    const { result, check, duplicate } = setup()
    await openOn(result)
    act(() => {
      result.current.setBranch('all')
    })
    expect(result.current.dialog).toMatchObject({ branch: 'all', state: { kind: 'checking' } })
    await flush()
    expect(check).toHaveBeenLastCalledWith('story_a', 'all')
    expect(result.current.dialog?.state).toEqual({ kind: 'ready' })
    await submitOn(result, { title: 'Copy', branch: 'all' })
    expect(duplicate).toHaveBeenCalledWith({ storyId: 'story_a', title: 'Copy', branch: 'all' })
  })

  it.each([
    ['all branches', 'all'],
    ['another branch', { branchId: MAIN.id }],
  ] as const)(
    'copies nothing for %s, a selection its check never judged, and checks it',
    async (_, branch: DuplicateBranch) => {
      const { result, check, duplicate } = setup()
      await openOn(result)
      expect(result.current.dialog).toMatchObject({
        branch: { branchId: FORK.id },
        state: { kind: 'ready' },
      })
      const gate = deferred<DuplicateCheck>()
      check.mockReturnValueOnce(gate.promise)
      await submitOn(result, { title: 'Copy', branch })
      expect(duplicate).not.toHaveBeenCalled()
      expect(check).toHaveBeenLastCalledWith('story_a', branch)
      expect(result.current.dialog).toMatchObject({ branch, state: { kind: 'checking' } })

      await act(async () => {
        gate.resolve(OK)
      })
      expect(result.current.dialog?.state).toEqual({ kind: 'ready' })
      await submitOn(result, { title: 'Copy', branch })
      expect(duplicate).toHaveBeenCalledTimes(1)
      expect(duplicate).toHaveBeenCalledWith({ storyId: 'story_a', title: 'Copy', branch })
    },
  )

  it('shows a refusal at the press as its line and keeps the dialog', async () => {
    const { result, duplicate, onDone } = setup()
    await openOn(result)
    duplicate.mockResolvedValueOnce({ status: 'rejected', code: 'run-registered' })
    await submitOn(result)
    expect(result.current.dialog?.state).toEqual({ kind: 'refused', reason: RUNNING })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('shows the failure for an empty-title refusal at the press and logs it', async () => {
    const { result, duplicate } = setup()
    await openOn(result)
    duplicate.mockResolvedValueOnce({ status: 'rejected', code: 'empty' })
    await submitOn(result)
    expect(result.current.dialog?.state).toEqual({ kind: 'failed' })
    expect(logger.warn).toHaveBeenCalledWith('app.story_duplicate_refused', {
      storyId: 'story_a',
      code: 'empty',
    })
  })

  it('logs a thrown copy, shows the failure, and copies on a retry', async () => {
    const { result, duplicate, onDone } = setup()
    await openOn(result)
    duplicate.mockRejectedValueOnce(new Error('disk full'))
    await submitOn(result)
    expect(result.current.dialog?.state).toEqual({ kind: 'failed' })
    expect(logger.error).toHaveBeenCalledWith('app.story_duplicate_threw', {
      storyId: 'story_a',
      error: 'disk full',
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()

    await submitOn(result)
    expect(duplicate).toHaveBeenCalledTimes(2)
    expect(result.current.dialog).toBeNull()
    expect(onDone).toHaveBeenCalledWith({ storyId: 'story_copy', title: 'Copy' })
  })

  it('toasts a thrown copy when the list lost focus during it', async () => {
    const { result, rerender, duplicate } = setup()
    await openOn(result)
    const copy = deferred<DuplicateStoryResult>()
    duplicate.mockReturnValueOnce(copy.promise)
    let submitting: Promise<void> = Promise.resolve()
    act(() => {
      submitting = result.current.submit(VALUES)
    })
    rerender({ focused: false, blocked: false })
    await act(async () => {
      copy.reject(new Error('disk full'))
      await submitting
    })
    expect(result.current.dialog).toBeNull()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(FAILED)
  })

  it('toasts a thrown copy that lands after the list unmounts', async () => {
    const { result, unmount, duplicate } = setup()
    await openOn(result)
    const copy = deferred<DuplicateStoryResult>()
    duplicate.mockReturnValueOnce(copy.promise)
    let submitting: Promise<void> = Promise.resolve()
    act(() => {
      submitting = result.current.submit(VALUES)
    })
    unmount()
    copy.reject(new Error('disk full'))
    await submitting
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(FAILED)
  })

  it('does nothing while a check runs or a refusal shows', async () => {
    const { result, check, duplicate } = setup()
    const gate = deferred<DuplicateCheck>()
    check.mockReturnValueOnce(gate.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.open('story_a', 'Aria')
    })
    await flush()
    await submitOn(result)
    expect(duplicate).not.toHaveBeenCalled()

    await act(async () => {
      gate.resolve({ status: 'rejected', code: 'swap-pending' })
      await opening
    })
    await submitOn(result)
    expect(duplicate).not.toHaveBeenCalled()
  })
})

describe('useStoryDuplicate: dismissing', () => {
  it('closes on dismiss', async () => {
    const { result } = setup()
    await openOn(result)
    act(() => {
      result.current.dismiss()
    })
    expect(result.current.dialog).toBeNull()
  })

  it('ignores a dismiss while copying', async () => {
    const { result, duplicate } = setup()
    await openOn(result)
    const copy = deferred<DuplicateStoryResult>()
    duplicate.mockReturnValueOnce(copy.promise)
    let submitting: Promise<void> = Promise.resolve()
    act(() => {
      submitting = result.current.submit(VALUES)
    })
    act(() => {
      result.current.dismiss()
    })
    expect(result.current.dialog?.state).toEqual({ kind: 'copying' })
    await act(async () => {
      copy.resolve({ status: 'rejected', code: 'swap-pending' })
      await submitting
    })
    expect(result.current.dialog?.state).toEqual({ kind: 'refused', reason: SWAP_PENDING })
  })

  it('dismisses when the list loses focus', async () => {
    const { result, rerender } = setup()
    await openOn(result)
    rerender({ focused: false, blocked: false })
    expect(result.current.dialog).toBeNull()
  })

  it('keeps a copying dialog when focus leaves, and dismisses it as the copy ends', async () => {
    const { result, rerender, duplicate, onDone } = setup()
    await openOn(result)
    const copy = deferred<DuplicateStoryResult>()
    duplicate.mockReturnValueOnce(copy.promise)
    let submitting: Promise<void> = Promise.resolve()
    act(() => {
      submitting = result.current.submit(VALUES)
    })
    rerender({ focused: false, blocked: false })
    expect(result.current.dialog?.state).toEqual({ kind: 'copying' })

    await act(async () => {
      copy.resolve({ status: 'rejected', code: 'swap-pending' })
      await submitting
    })
    expect(result.current.dialog).toBeNull()
    expect(onDone).not.toHaveBeenCalled()
  })
})
