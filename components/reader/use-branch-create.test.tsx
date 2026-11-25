// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ReplaceStoryStack } from '@/hooks/use-replace-story-stack'
import { FORK_REFUSAL, type ForkResult, type ShowBranchResult } from '@/lib/actions'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema, type StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  currentStoryStore,
  entriesStore,
  generationStore,
  readerHoldStore,
  resetAllStores,
  type RunState,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

import type { BranchCreateModalProps } from './branch-create-modal'
import { useBranchCreate, type BranchCreate, type UseBranchCreateArgs } from './use-branch-create'
import { useReaderDispatch, type ReaderDispatch } from './use-reader-dispatch'

const actions = vi.hoisted(() => ({ fork: vi.fn(), show: vi.fn() }))
vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  forkBranch: actions.fork,
  showBranch: actions.show,
}))

const branchList = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@/lib/stores', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refreshBranches: branchList.refresh,
}))

// The runtime `db` is a bridge client; the hook only hands it to the mocked actions.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
}))

const STORY = 'story_1'
const BRANCH = 'br_main'
const CHILD = 'br_child'
const ENTRY = 'entry_47'
const CTX = { db: {}, runInTransaction: expect.any(Function) }
const COPY = {
  gate: 'Generation is in flight. Cancel to edit.',
  memoryGate: 'Updating memory. Cancel to edit.',
  closeGate: 'Chapter close in progress. Cancel to edit.',
  swap: 'Unavailable while the embedder switch finishes.',
  unfinishedRun:
    'The memory work after this entry never finished, so branch from an earlier entry.',
  entryGone: 'This entry is no longer on the branch.',
  failed: "Couldn't create the branch.",
}

const PENDING = { kind: 'pending' }
const idle = (line: string | null) => ({ kind: 'idle', line })

const replaceStack = vi.fn<ReplaceStoryStack>(() => true)

function openOn(branchId: string): void {
  currentStoryStore.set({
    storyId: STORY,
    branchId,
    definition: storyDefinitionSchema.parse({
      mode: 'adventure',
      leadEntityId: 'char_kael',
      narration: 'second',
      genre: { label: 'Fantasy', promptBody: '' },
      tone: { label: 'Wry', promptBody: '' },
      setting: '',
      calendarSystemId: 'gregorian',
      worldTimeOrigin: { year: 0 },
    }),
    settings: STORY_SETTINGS_DEFAULTS,
  })
}

function reply(id: string, position: number): StoryEntry {
  return {
    id,
    branchId: BRANCH,
    position,
    kind: 'ai_reply',
    content: `Entry ${position}`,
    contentTokens: null,
    chapterId: null,
    metadata: null,
    createdAt: position,
  }
}

// A memory pass of the story: no gate, so forkBranch's own refusal wouldn't see it.
function passRun(): RunState {
  return {
    runId: 'run_pass',
    kind: PERIODIC_CLASSIFIER_KIND,
    gateBehavior: 'no-gate',
    interruptible: 'pass',
    beforeTurn: false,
    actionId: 'act_pass',
    storyId: STORY,
    branchId: BRANCH,
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

// A chapter close of the story: the hard gate forkBranch's own check refuses on.
function closeRun(): RunState {
  return {
    ...passRun(),
    runId: 'run_close',
    kind: CHAPTER_CLOSE_KIND,
    gateBehavior: 'hard-gate',
    interruptible: 'close',
    actionId: 'act_close',
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

type Props = Pick<UseBranchCreateArgs, 'storyId' | 'swapPending'>

/** The hook as the route holds it, beside the reader's own dispatch guard. */
function renderCreate(initial: Partial<Props> = {}) {
  return renderHook(
    ({ storyId, swapPending }: Props): { dispatch: ReaderDispatch; create: BranchCreate } => {
      const dispatch = useReaderDispatch(BRANCH)
      const create = useBranchCreate({
        storyId,
        branchId: BRANCH,
        isDispatchBlocked: dispatch.isBlocked,
        replaceStack,
        swapPending,
      })
      return { dispatch, create }
    },
    { initialProps: { storyId: STORY, swapPending: false, ...initial } },
  )
}
type Hook = ReturnType<typeof renderCreate>

function modal(hook: Hook): BranchCreateModalProps {
  const shown = hook.result.current.create.modal
  if (shown == null) throw new Error('the creation modal is not open')
  return shown
}

async function openModal(hook: Hook): Promise<void> {
  await act(() => hook.result.current.create.onBranch(ENTRY))
}

function press(hook: Hook, name: string): void {
  act(() => modal(hook).onCreate(name))
}

// Past every awaited mock in the press's chain.
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

let info: MockInstance<typeof toast.info>
let warning: MockInstance<typeof toast.warning>
let error: MockInstance<typeof toast.error>
let logWarn: MockInstance<typeof logger.warn>
let logError: MockInstance<typeof logger.error>

function expectNoToast(): void {
  expect(info).not.toHaveBeenCalled()
  expect(warning).not.toHaveBeenCalled()
  expect(error).not.toHaveBeenCalled()
}

beforeEach(() => {
  resetAllStores()
  openOn(BRANCH)
  entriesStore.hydrate(BRANCH, [reply(ENTRY, 47)])
  actions.fork.mockReset().mockResolvedValue({ status: 'ok', branchId: CHILD })
  actions.show.mockReset().mockResolvedValue({ status: 'ok' })
  branchList.refresh.mockReset().mockResolvedValue(undefined)
  replaceStack.mockClear()
  info = vi.spyOn(toast, 'info').mockReturnValue('')
  warning = vi.spyOn(toast, 'warning').mockReturnValue('')
  error = vi.spyOn(toast, 'error').mockReturnValue('')
  logWarn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetAllStores()
})

describe('useBranchCreate — opening', () => {
  it('opens the modal on the pressed entry, at its position, with no line', async () => {
    const hook = renderCreate()
    expect(hook.result.current.create.modal).toBeNull()
    await openModal(hook)
    expect(modal(hook)).toMatchObject({
      entryPosition: 47,
      phase: idle(null),
      createBlockedReason: undefined,
    })
  })

  it('settles when opening throws: logs, toasts, opens nothing', async () => {
    vi.spyOn(entriesStore, 'getById').mockImplementation(() => {
      throw new Error('store gone')
    })
    const hook = renderCreate()
    let settled = false
    await act(async () => {
      await hook.result.current.create.onBranch(ENTRY)
      settled = true
    })
    expect(settled).toBe(true)
    expect(logError).toHaveBeenCalledExactlyOnceWith('reader.branch_create_open_failed', {
      branchId: BRANCH,
      entryId: ENTRY,
      error: 'store gone',
    })
    expect(error).toHaveBeenCalledExactlyOnceWith(COPY.failed)
    expect(hook.result.current.create.modal).toBeNull()
  })

  it('opens nothing while a dispatch is in flight', async () => {
    const hook = renderCreate()
    act(() => {
      hook.result.current.dispatch.begin()
    })
    await openModal(hook)
    expect(hook.result.current.create.modal).toBeNull()
  })

  it('opens nothing while the story is unknown', async () => {
    const hook = renderCreate({ storyId: null })
    await openModal(hook)
    expect(hook.result.current.create.modal).toBeNull()
  })

  it('opens nothing for an entry no longer on the branch, and logs it', async () => {
    const hook = renderCreate()
    await act(() => hook.result.current.create.onBranch('entry_gone'))
    expect(hook.result.current.create.modal).toBeNull()
    expect(logWarn).toHaveBeenCalledExactlyOnceWith('reader.branch_create_entry_missing', {
      branchId: BRANCH,
      entryId: 'entry_gone',
    })
  })

  it('under a pending swap opens refused, and its Create forks nothing', async () => {
    const hook = renderCreate({ swapPending: true })
    await openModal(hook)
    expect(modal(hook).createBlockedReason).toBe(COPY.swap)
    press(hook, 'Side quest')
    await settle()
    expect(actions.fork).not.toHaveBeenCalled()
    expect(modal(hook).phase).toStrictEqual(idle(null))
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
  })

  it('Cancel closes the modal', async () => {
    const hook = renderCreate()
    await openModal(hook)
    act(() => modal(hook).onCancel())
    expect(hook.result.current.create.modal).toBeNull()
  })
})

describe('useBranchCreate — Create', () => {
  it("forks the route's branch at the entry, shows the new branch through the stack reset, then refreshes the list; no toast", async () => {
    const order: string[] = []
    actions.fork.mockImplementation(async () => {
      order.push('fork')
      return { status: 'ok', branchId: CHILD }
    })
    actions.show.mockImplementation(async () => {
      order.push('show')
      return { status: 'ok' }
    })
    branchList.refresh.mockImplementation(async () => {
      order.push('refresh')
    })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, '  Side quest  ')
    await settle()
    expect(order).toStrictEqual(['fork', 'show', 'refresh'])
    // As typed: forkBranch trims it.
    expect(actions.fork).toHaveBeenCalledExactlyOnceWith(
      { parentBranchId: BRANCH, forkEntryId: ENTRY, name: '  Side quest  ', makeCurrent: true },
      CTX,
    )
    expect(actions.show).toHaveBeenCalledExactlyOnceWith(
      {
        storyId: STORY,
        branchId: CHILD,
        fromBranchId: BRANCH,
        hold: expect.objectContaining({ branchId: BRANCH }),
        replaceStack,
      },
      CTX,
    )
    expect(branchList.refresh).toHaveBeenCalledExactlyOnceWith({}, STORY)
    expectNoToast()
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
  })

  it('adds nothing of its own when the tail navigated with nothing loaded', async () => {
    actions.show.mockResolvedValue({ status: 'shown-unloaded' })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(branchList.refresh).toHaveBeenCalledExactlyOnceWith({}, STORY)
    expectNoToast()
    expect(logWarn).not.toHaveBeenCalled()
  })

  it('logs a refresh that rejects, with no line and no toast', async () => {
    branchList.refresh.mockRejectedValue(new Error('disk'))
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(logWarn).toHaveBeenCalledExactlyOnceWith('app.branches_refresh_failed', {
      storyId: STORY,
      error: 'disk',
    })
    expect(modal(hook).phase).toStrictEqual(PENDING)
    expectNoToast()
  })

  it('a second press while the first runs forks nothing more', async () => {
    const forked = deferred<ForkResult>()
    actions.fork.mockReturnValue(forked.promise)
    const hook = renderCreate()
    await openModal(hook)
    act(() => {
      const { onCreate } = modal(hook)
      onCreate('Side quest')
      onCreate('Side quest')
    })
    press(hook, 'Side quest')
    expect(actions.fork).toHaveBeenCalledTimes(1)
    expect(modal(hook).phase).toStrictEqual(PENDING)
    await act(async () => forked.resolve({ status: 'ok', branchId: CHILD }))
    await settle()
    expect(actions.fork).toHaveBeenCalledTimes(1)
  })

  it('holds the reader across the fork and the tail: a Send refuses and registers no pending turn', async () => {
    const forked = deferred<ForkResult>()
    const tail = deferred<ShowBranchResult>()
    actions.fork.mockReturnValue(forked.promise)
    actions.show.mockReturnValue(tail.promise)
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')

    const expectHeld = () => {
      expect(readerHoldStore.isHeld(BRANCH)).toBe(true)
      expect(hook.result.current.dispatch.begin()).toBe(false)
      expect(generationStore.getTxState().pendingTurns.size).toBe(0)
      expect(modal(hook).phase).toStrictEqual(PENDING)
    }
    expectHeld()

    await act(async () => forked.resolve({ status: 'ok', branchId: CHILD }))
    await settle()
    expect(actions.show).toHaveBeenCalledTimes(1)
    expectHeld()

    await act(async () => tail.resolve({ status: 'ok' }))
    await settle()
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
    // The hold, not a dispatch of the reader's own, refused that Send.
    let begun = false
    act(() => {
      begun = hook.result.current.dispatch.begin()
    })
    expect(begun).toBe(true)
  })

  // The gated row's run starts inside the fork, past the pre-check: its line names that run.
  it.each([
    [FORK_REFUSAL.gated, COPY.closeGate, false, true],
    [FORK_REFUSAL.swapPending, COPY.swap, false, false],
    [FORK_REFUSAL.unfinishedRun, COPY.unfinishedRun, false, false],
    [FORK_REFUSAL.entryMissing, COPY.entryGone, false, false],
    [FORK_REFUSAL.entrySystem, COPY.entryGone, false, false],
    [FORK_REFUSAL.rollbackFloor, COPY.failed, true, false],
    [FORK_REFUSAL.integrity, COPY.failed, true, false],
    ['lock-timeout', COPY.failed, true, false],
  ] as const)(
    'on %s keeps the modal open with its line and ends the hold; nothing follows',
    async (code, line, logged, runStarts) => {
      actions.fork.mockImplementation(async () => {
        if (runStarts) generationStore.startRun(closeRun())
        return { status: 'rejected', code, reason: 'no create delta for br_main' }
      })
      const hook = renderCreate()
      await openModal(hook)
      press(hook, 'Side quest')
      await settle()
      expect(modal(hook).phase).toStrictEqual(idle(line))
      expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
      expect(actions.show).not.toHaveBeenCalled()
      expect(branchList.refresh).not.toHaveBeenCalled()
      expectNoToast()
      if (logged)
        expect(logWarn).toHaveBeenCalledExactlyOnceWith('reader.branch_create_refused', {
          branchId: BRANCH,
          entryId: ENTRY,
          code,
          reason: 'no create delta for br_main',
        })
      else expect(logWarn).not.toHaveBeenCalled()
    },
  )

  it('shows the failed line on a throw, keeps the modal open, ends the hold and logs; no tail', async () => {
    actions.fork.mockRejectedValue(new Error('disk'))
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(modal(hook).phase).toStrictEqual(idle(COPY.failed))
    expect(logError).toHaveBeenCalledExactlyOnceWith('reader.branch_create_failed', {
      branchId: BRANCH,
      entryId: ENTRY,
      error: 'disk',
    })
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
    expect(actions.show).not.toHaveBeenCalled()
    expect(branchList.refresh).not.toHaveBeenCalled()
    expectNoToast()
  })

  it("refuses with the gate's line, before forking, while a run of the story holds no gate", async () => {
    const hook = renderCreate()
    await openModal(hook)
    act(() => generationStore.startRun(passRun()))
    press(hook, 'Side quest')
    await settle()
    expect(actions.fork).not.toHaveBeenCalled()
    expect(modal(hook).phase).toStrictEqual(idle(COPY.memoryGate))
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
  })

  it("refuses with the gate's line, before forking, while a turn body still runs on the branch", async () => {
    const body = deferred<void>()
    act(() => {
      void generationStore.bracketPendingTurn(BRANCH, (endEarly) => {
        endEarly()
        return body.promise
      })
    })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(actions.fork).not.toHaveBeenCalled()
    expect(modal(hook).phase).toStrictEqual(idle(COPY.gate))
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
    await act(async () => body.resolve())
  })

  it('a throw past its own catches before the commit ends pending with the failed line, ends the hold and logs; a retry forks again', async () => {
    actions.fork.mockResolvedValue({ status: 'rejected', code: 'lock-timeout', reason: 'x' })
    logWarn.mockImplementation(() => {
      throw new Error('log broke')
    })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(modal(hook).phase).toStrictEqual(idle(COPY.failed))
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
    expect(logError).toHaveBeenCalledExactlyOnceWith('reader.branch_create_threw', {
      branchId: BRANCH,
      entryId: ENTRY,
      error: 'log broke',
    })
    press(hook, 'Side quest')
    await settle()
    expect(actions.fork).toHaveBeenCalledTimes(2)
  })

  it('a throw past its own catches after the commit closes the modal and ends the hold; a reopened Create forks again', async () => {
    actions.fork.mockImplementation(async () => {
      openOn('br_other')
      return { status: 'ok', branchId: CHILD }
    })
    branchList.refresh.mockImplementation(() => {
      throw new Error('refresh broke')
    })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(hook.result.current.create.modal).toBeNull()
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
    expect(logError).toHaveBeenCalledExactlyOnceWith('reader.branch_create_threw', {
      branchId: BRANCH,
      entryId: ENTRY,
      error: 'refresh broke',
    })
    await openModal(hook)
    expect(modal(hook).phase).toStrictEqual(idle(null))
    press(hook, 'Side quest')
    await settle()
    expect(actions.fork).toHaveBeenCalledTimes(2)
  })

  it("on a tail that can't navigate, refreshes the list, closes the modal and warns", async () => {
    actions.show.mockResolvedValue({ status: 'navigation-blocked' })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, '  Side quest  ')
    await settle()
    expect(branchList.refresh).toHaveBeenCalledExactlyOnceWith({}, STORY)
    expect(hook.result.current.create.modal).toBeNull()
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      'Created "Side quest" but couldn\'t open it. Switch to it from the branch chip.',
    )
    expect(logWarn).toHaveBeenCalledExactlyOnceWith('reader.branch_create_not_opened', {
      branchId: BRANCH,
      newBranchId: CHILD,
    })
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
  })

  it('on a tail that throws past its reset, closes the modal, ends the hold and refreshes; no toast', async () => {
    actions.show.mockRejectedValue(new Error('disk'))
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(hook.result.current.create.modal).toBeNull()
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
    expect(branchList.refresh).toHaveBeenCalledExactlyOnceWith({}, STORY)
    expect(logError).toHaveBeenCalledExactlyOnceWith('reader.branch_create_show_threw', {
      branchId: BRANCH,
      newBranchId: CHILD,
      error: 'disk',
    })
    expectNoToast()
  })

  it.each([
    ['switched to another branch', () => openOn('br_other'), true],
    ['closed', () => currentStoryStore.clear(), false],
    [
      'left for another story',
      () => {
        const open = currentStoryStore.getCurrentStory()
        if (open == null) throw new Error('no open story to leave')
        currentStoryStore.set({ ...open, storyId: 'story_other', branchId: 'br_elsewhere' })
      },
      false,
    ],
  ] as const)(
    'with the story %s by the commit, skips the tail and closes the modal',
    async (_name, leave, refreshes) => {
      actions.fork.mockImplementation(async () => {
        leave()
        return { status: 'ok', branchId: CHILD }
      })
      const hook = renderCreate()
      await openModal(hook)
      press(hook, 'Side quest')
      await settle()
      expect(actions.show).not.toHaveBeenCalled()
      // The list store holds one story: only this story, still open, is refreshed.
      if (refreshes) expect(branchList.refresh).toHaveBeenCalledExactlyOnceWith({}, STORY)
      else expect(branchList.refresh).not.toHaveBeenCalled()
      expect(hook.result.current.create.modal).toBeNull()
      expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
      expectNoToast()
    },
  )

  it('forks nothing once the story is unknown', async () => {
    const hook = renderCreate()
    await openModal(hook)
    hook.rerender({ storyId: null, swapPending: false })
    press(hook, 'Side quest')
    await settle()
    expect(actions.fork).not.toHaveBeenCalled()
  })

  it('Cancel while pending keeps the modal open', async () => {
    actions.fork.mockReturnValue(new Promise(() => {}))
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    act(() => modal(hook).onCancel())
    expect(modal(hook).phase).toStrictEqual(PENDING)
  })

  it('reopens with no line after a refusal and a Cancel', async () => {
    actions.fork.mockResolvedValue({
      status: 'rejected',
      code: FORK_REFUSAL.unfinishedRun,
      reason: 'x',
    })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(modal(hook).phase).toStrictEqual(idle(COPY.unfinishedRun))
    act(() => modal(hook).onCancel())
    await openModal(hook)
    expect(modal(hook).phase).toStrictEqual(idle(null))
  })

  it("reopens idle after a tail that can't navigate, and its Create forks again", async () => {
    actions.show.mockResolvedValue({ status: 'navigation-blocked' })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(hook.result.current.create.modal).toBeNull()
    await openModal(hook)
    expect(modal(hook).phase).toStrictEqual(idle(null))
    press(hook, 'Side quest')
    await settle()
    expect(actions.fork).toHaveBeenCalledTimes(2)
  })

  it('a retry clears the earlier line on its press, and its own refusal replaces it', async () => {
    actions.fork.mockResolvedValueOnce({
      status: 'rejected',
      code: FORK_REFUSAL.unfinishedRun,
      reason: 'x',
    })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(modal(hook).phase).toStrictEqual(idle(COPY.unfinishedRun))

    const forked = deferred<ForkResult>()
    actions.fork.mockReturnValueOnce(forked.promise)
    press(hook, 'Side quest')
    expect(modal(hook).phase).toStrictEqual(PENDING)
    await act(async () =>
      forked.resolve({ status: 'rejected', code: FORK_REFUSAL.entryMissing, reason: 'x' }),
    )
    await settle()
    expect(modal(hook).phase).toStrictEqual(idle(COPY.entryGone))
  })

  it("a swap starting or ending shows live, and a refusal's line stays through it", async () => {
    actions.fork.mockResolvedValue({ status: 'rejected', code: FORK_REFUSAL.gated, reason: 'x' })
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(modal(hook).phase).toStrictEqual(idle(COPY.gate))

    hook.rerender({ storyId: STORY, swapPending: true })
    expect(modal(hook)).toMatchObject({ createBlockedReason: COPY.swap, phase: idle(COPY.gate) })
    hook.rerender({ storyId: STORY, swapPending: false })
    expect(modal(hook)).toMatchObject({ createBlockedReason: undefined, phase: idle(COPY.gate) })
  })
})

describe('useBranchCreate — a log that throws while a throw is handled', () => {
  // A listener of our own makes vitest leave the expected rejection to the test.
  const rejections: unknown[] = []
  const onRejection = (reason: unknown) => {
    rejections.push(reason)
  }
  beforeEach(() => {
    rejections.length = 0
    process.on('unhandledRejection', onRejection)
  })
  afterEach(() => {
    process.off('unhandledRejection', onRejection)
  })

  const logBroke = new Error('error log broke')
  function breakErrorLog(): void {
    logError.mockImplementation(() => {
      throw logBroke
    })
  }

  it('before the commit still ends pending with the failed line; Cancel closes, and Create forks again', async () => {
    actions.fork.mockResolvedValueOnce({ status: 'rejected', code: 'lock-timeout', reason: 'x' })
    logWarn.mockImplementation(() => {
      throw new Error('log broke')
    })
    breakErrorLog()
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(modal(hook).phase).toStrictEqual(idle(COPY.failed))
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
    await vi.waitFor(() => expect(rejections).toStrictEqual([logBroke]))

    act(() => modal(hook).onCancel())
    expect(hook.result.current.create.modal).toBeNull()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(actions.fork).toHaveBeenCalledTimes(2)
  })

  it('after the commit still closes the modal, and a reopened Create forks again', async () => {
    actions.fork.mockImplementationOnce(async () => {
      openOn('br_other')
      return { status: 'ok', branchId: CHILD }
    })
    branchList.refresh.mockImplementationOnce(() => {
      throw new Error('refresh broke')
    })
    breakErrorLog()
    const hook = renderCreate()
    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(hook.result.current.create.modal).toBeNull()
    expect(readerHoldStore.isHeld(BRANCH)).toBe(false)
    await vi.waitFor(() => expect(rejections).toStrictEqual([logBroke]))

    await openModal(hook)
    press(hook, 'Side quest')
    await settle()
    expect(actions.fork).toHaveBeenCalledTimes(2)
  })
})
