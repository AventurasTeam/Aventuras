// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
  type MockInstance,
} from 'vitest'

import type { ReplaceStoryStack } from '@/hooks/use-replace-story-stack'
import {
  CLOSE_RERUN_REFUSAL,
  CLOSE_RERUN_TURNS_FOLLOWED,
  DeltaReplayError,
  FORK_REFUSAL,
  MANUAL_CLOSE_REFUSAL,
  STORY_ENTRY_REJECTION,
  type CloseRerunParentCheck,
  type CloseRerunPreview,
  type CloseRerunForkPreview,
  type CloseRerunForkStart,
  type CloseRerunShortcut,
  type CloseRerunStart,
  type ForkBranchInput,
  type RollbackCounts,
} from '@/lib/actions'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { db, STORY_SETTINGS_DEFAULTS, storyDefinitionSchema } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { EMBEDDER_SWAP_REFUSAL } from '@/lib/embedder-swap'
import { t } from '@/lib/i18n'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  type ChainEnd,
  type PipelineError,
} from '@/lib/pipeline'
import {
  currentStoryStore,
  generationStore,
  readerHoldStore,
  RERUN_HELD,
  resetAllStores,
  type OpenStory,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

import {
  expectedOf,
  rerunEndNotice,
  rerunStartOutcome,
  runCloseRerun,
  runCloseRerunOnBranch,
} from './run-close-rerun'

// The close-failure copy's module also holds a hook on expo-router, which the unit project can't load.
vi.mock('expo-router', () => ({ useRouter: () => ({}) }))

const actions = vi.hoisted(() => ({
  start: vi.fn(),
  load: vi.fn(),
  check: vi.fn(),
  fork: vi.fn(),
  show: vi.fn(),
  startOnFork: vi.fn(),
}))
vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startCloseRerun: actions.start,
  loadOpenStory: actions.load,
  checkCloseRerunParent: actions.check,
  forkBranch: actions.fork,
  showBranch: actions.show,
  startCloseRerunOnFork: actions.startOnFork,
}))

const branchList = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@/lib/stores', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refreshBranches: branchList.refresh,
}))

const COUNTS: RollbackCounts = {
  entries: 15,
  chapters: 0,
  worldStateChanges: 12,
  closeWrites: 0,
  reopenedChapter: null,
  removedChapters: [],
}

const PREVIEW: CloseRerunPreview = {
  chapterNumber: 2,
  branchName: 'Main',
  model: 'gemma-4-26b',
  tokens: 24_310,
  reversal: { createdLore: { count: 2, userEdited: true }, otherChanges: 31 },
  shortcut: {
    targetEntryId: 'entry_58',
    forkPoint: { entryId: 'entry_57', position: 57 },
    turns: 7,
    entries: { count: 15, first: 58, last: 72 },
    counts: COUNTS,
  },
}

const FRESH: CloseRerunPreview = {
  ...PREVIEW,
  reversal: { createdLore: { count: 3, userEdited: true }, otherChanges: 31 },
}

const TOOL_OFF: PipelineError = {
  kind: 'config-resolver',
  failure: 'tool-calling-off',
  target: 'lore-mgmt',
  phaseName: 'agent',
  modelId: 'gemma-4-26b',
}

const RUN = { runId: 'run_rerun', actionId: 'act_rerun' }

const END = {
  committed: {
    kind: CHAPTER_CLOSE_KIND,
    result: { ...RUN, outcome: 'completed' },
    cancelled: false,
  },
  committedAsCancelLanded: {
    kind: CHAPTER_CLOSE_KIND,
    result: { ...RUN, outcome: 'completed' },
    cancelled: true,
  },
  aborted: { kind: CHAPTER_CLOSE_KIND, result: { ...RUN, outcome: 'aborted' } },
  failed: {
    kind: CHAPTER_CLOSE_KIND,
    result: {
      ...RUN,
      outcome: 'failed',
      error: { kind: 'provider', reason: 'network', detail: 'socket hang up\n    at TLSSocket' },
    },
  },
  failedBare: {
    kind: CHAPTER_CLOSE_KIND,
    result: { ...RUN, outcome: 'failed', error: { kind: 'provider', reason: 'network' } },
  },
  abortedUndone: {
    kind: CHAPTER_CLOSE_KIND,
    result: { ...RUN, outcome: 'aborted', closeUndone: true },
  },
  failedUnreversed: {
    kind: CHAPTER_CLOSE_KIND,
    result: {
      ...RUN,
      outcome: 'failed',
      error: { kind: 'orchestrator', detail: 'reverse-replay failed: disk I/O error' },
      unreversed: true,
    },
  },
  failedUndone: {
    kind: CHAPTER_CLOSE_KIND,
    result: {
      ...RUN,
      outcome: 'failed',
      error: { kind: 'orchestrator', detail: 'boom' },
      closeUndone: true,
    },
  },
  passFailed: {
    kind: PERIODIC_CLASSIFIER_KIND,
    result: { ...RUN, outcome: 'failed', error: { kind: 'orchestrator', detail: 'x' } },
  },
  passAborted: { kind: PERIODIC_CLASSIFIER_KIND, result: { ...RUN, outcome: 'aborted' } },
} as const satisfies Record<string, ChainEnd>

const rerun = () => runCloseRerun({ branchId: 'br_1', chapterId: 'chap_2', preview: PREVIEW })

function replayFailure(stage: 'transaction' | 'store-sync'): DeltaReplayError {
  return new DeltaReplayError('reverse replay failed', {
    cause: new Error('UNIQUE constraint failed'),
    actionId: 'act_sweep',
    stage,
  })
}

function story(branchId: string): OpenStory {
  return {
    storyId: 'story_1',
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
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

let info: MockInstance<typeof toast.info>
let warning: MockInstance<typeof toast.warning>
let error: MockInstance<typeof toast.error>
let logWarn: MockInstance<typeof logger.warn>
let logError: MockInstance<typeof logger.error>

beforeEach(() => {
  actions.start.mockReset()
  actions.load.mockReset()
  info = vi.spyOn(toast, 'info').mockReturnValue('')
  warning = vi.spyOn(toast, 'warning').mockReturnValue('')
  error = vi.spyOn(toast, 'error').mockReturnValue('')
  logWarn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  resetAllStores()
})

describe('expectedOf', () => {
  it("carries the shortcut's target and counts and the reversal's counts the confirm showed", () => {
    expect(expectedOf(PREVIEW)).toStrictEqual({
      shortcut: { targetEntryId: 'entry_58', counts: COUNTS },
      reversal: { createdLore: { count: 2, userEdited: true }, otherChanges: 31 },
    })
    expect(expectedOf({ ...PREVIEW, shortcut: null }).shortcut).toBeNull()
  })
})

describe('rerunEndNotice', () => {
  it.each([
    ['committed', END.committed],
    ['committed as a cancel landed', END.committedAsCancelLanded],
    ["a catch-up pass's failure", END.passFailed],
    ["a catch-up pass's cancel", END.passAborted],
  ] as const)('says nothing for %s', (_name, end) => {
    expect(rerunEndNotice(end, 2)).toBeNull()
  })

  it.each([
    ['cancelled', END.aborted, 'info', t('chapters:rerunNotice.cancelled', { number: 2 })],
    [
      'failed, with the first line of its reason',
      END.failed,
      'warning',
      t('chapters:rerunNotice.failedWithReason', { number: 2, reason: 'socket hang up' }),
    ],
    [
      'failed, with no reason to give',
      END.failedBare,
      'warning',
      t('chapters:rerunNotice.failed', { number: 2 }),
    ],
    [
      'cancelled with its close undone',
      END.abortedUndone,
      'warning',
      t('chapters:rerunNotice.undone', { number: 2 }),
    ],
    [
      'failed with its close undone',
      END.failedUndone,
      'warning',
      t('chapters:rerunNotice.undone', { number: 2 }),
    ],
    [
      "stopped with a reversal that didn't commit",
      END.failedUnreversed,
      'error',
      t('chapters:rerunNotice.unreversed', { number: 2 }),
    ],
  ] as const)('speaks for a re-run %s', (_name, end, severity, message) => {
    expect(rerunEndNotice(end, 2)).toStrictEqual({ severity, message })
  })

  it('tells a held re-run that its branch, not the story, waits on the restart', () => {
    expect(rerunEndNotice(END.failedUnreversed, 2)?.message).toBe(
      "The re-run couldn't be undone. Restart the app to restore chapter 2's close; until then, this branch can't be changed.",
    )
  })
})

describe('rerunStartOutcome', () => {
  const COUNTS_CHANGED_PREVIEW: CloseRerunStart = {
    status: 'rejected',
    code: 'counts-changed',
    reason: 'the reversal moved',
    preview: FRESH,
  }

  it('re-opens on the fresh preview a refusal carries, with the counts-changed copy', () => {
    expect(rerunStartOutcome(COUNTS_CHANGED_PREVIEW, 2)).toStrictEqual({
      step: { step: 'replace', preview: FRESH },
      notice: { severity: 'error', message: t('chapters:rerunNotice.countsChanged') },
      logCode: null,
    })
  })

  it.each([
    ['a busy story', { outcome: 'rejected', blockedBy: MANUAL_CLOSE_REFUSAL.busy }],
    [
      "the shortcut's in-flight refusal",
      { status: 'rejected', code: STORY_ENTRY_REJECTION.inFlight, reason: 'x' },
    ],
  ] as const)('keeps the confirm open for %s, saying a run is in flight', (_name, start) => {
    expect(rerunStartOutcome(start, 2)).toStrictEqual({
      step: { step: 'keep-open' },
      notice: { severity: 'error', message: 'Unavailable while generating.' },
      logCode: null,
    })
  })

  it.each([
    [CLOSE_RERUN_REFUSAL.notLatest, t('chapters:rerunConfirm.notLatest')],
    [CLOSE_RERUN_REFUSAL.closeOwed, t('chapters:rerunConfirm.closeOwed')],
  ] as const)("closes on %s with the preview's own copy, unlogged", (code, message) => {
    expect(rerunStartOutcome({ status: 'rejected', code, reason: 'x' }, 2)).toStrictEqual({
      step: { step: 'refused' },
      notice: { severity: 'error', message },
      logCode: null,
    })
  })

  it.each([
    [EMBEDDER_SWAP_REFUSAL, t('reader:actions.blockedWhileSwapping')],
    [CLASSIFIER_HELD, t('reader:systemEntry.closeRetryBlocked')],
    [RERUN_HELD, t('generationGate.rerunHeld')],
  ] as const)(
    'closes on %s with the copy for a refusal that outlasts the press, logging the code',
    (code, message) => {
      expect(rerunStartOutcome({ outcome: 'rejected', blockedBy: code }, 2)).toStrictEqual({
        step: { step: 'refused' },
        notice: { severity: 'error', message },
        logCode: code,
      })
    },
  )

  it.each([
    ['no-close', { status: 'rejected', code: CLOSE_RERUN_REFUSAL.noClose, reason: 'x' }],
    ['integrity', { status: 'rejected', code: CLOSE_RERUN_REFUSAL.integrity, reason: 'x' }],
    [
      MANUAL_CLOSE_REFUSAL.branchNotOpen,
      { outcome: 'rejected', blockedBy: MANUAL_CLOSE_REFUSAL.branchNotOpen },
    ],
    [
      STORY_ENTRY_REJECTION.rollbackFloor,
      { status: 'rejected', code: STORY_ENTRY_REJECTION.rollbackFloor, reason: 'x' },
    ],
  ] as const)('closes on %s with the failure copy, logging the code', (code, start) => {
    expect(rerunStartOutcome(start, 2)).toStrictEqual({
      step: { step: 'refused' },
      notice: { severity: 'error', message: t('chapters:rerunNotice.startFailed') },
      logCode: code,
    })
  })

  it("closes on a failed pre-flight with the close's own copy, naming the model", () => {
    const outcome = rerunStartOutcome({ outcome: 'preflight-failed', error: TOOL_OFF }, 2)
    expect(outcome.step).toStrictEqual({ step: 'refused' })
    expect(outcome.notice?.severity).toBe('warning')
    expect(outcome.notice?.message).toContain('gemma-4-26b')
    expect(outcome.logCode).toBe('preflight-failed')
  })

  it("closes on a catch-up pass's failed pre-flight with the memory pass's own copy", () => {
    const classifierGone: PipelineError = {
      kind: 'config-resolver',
      failure: 'profile-missing',
      target: 'classifier',
      phaseName: 'classify',
    }
    expect(
      rerunStartOutcome({ outcome: 'preflight-failed', error: classifierGone }, 2),
    ).toStrictEqual({
      step: { step: 'refused' },
      notice: {
        severity: 'warning',
        message: t('reader:systemEntry.failure.memoryProfileMissing'),
      },
      logCode: 'preflight-failed',
    })
  })

  it("hands a chain's end to the end notice", () => {
    expect(rerunStartOutcome(END.aborted, 2)).toStrictEqual({
      step: { step: 'ended' },
      notice: { severity: 'info', message: t('chapters:rerunNotice.cancelled', { number: 2 }) },
      logCode: null,
    })
  })
})

describe('runCloseRerun', () => {
  it("starts the re-run on the preview's expected counts over the app database", async () => {
    actions.start.mockResolvedValue(END.committed)
    const onStarted = vi.fn()
    expect(
      await runCloseRerun({
        branchId: 'br_1',
        chapterId: 'chap_2',
        preview: PREVIEW,
        onStarted,
      }),
    ).toStrictEqual({ step: 'ended' })
    expect(actions.start).toHaveBeenCalledExactlyOnceWith(
      'br_1',
      'chap_2',
      {
        shortcut: { targetEntryId: 'entry_58', counts: COUNTS },
        reversal: { createdLore: { count: 2, userEdited: true }, otherChanges: 31 },
      },
      { db: expect.anything(), runInTransaction: expect.any(Function) },
      { onStarted },
    )
    expect(info).not.toHaveBeenCalled()
    expect(warning).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('toasts the notice at its severity and logs a refusal', async () => {
    actions.start.mockResolvedValue({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.noClose,
      reason: 'x',
    })
    expect(await rerun()).toStrictEqual({ step: 'refused' })
    expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.startFailed'))
    expect(logWarn).toHaveBeenCalledExactlyOnceWith('app.close_rerun_start_refused', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      code: CLOSE_RERUN_REFUSAL.noClose,
    })
  })

  it("toasts a re-run's cancel when its chain ends, minutes after the start", async () => {
    actions.start.mockResolvedValue(END.aborted)
    await rerun()
    expect(info).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.cancelled', { number: 2 }))
    expect(logWarn).not.toHaveBeenCalled()
  })

  it('logs a throw and toasts the failure copy', async () => {
    actions.start.mockRejectedValue(new Error('disk'))
    expect(await rerun()).toStrictEqual({ step: 'refused' })
    expect(logError).toHaveBeenCalledExactlyOnceWith('app.close_rerun_start_threw', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      error: 'disk',
    })
    expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.startFailed'))
  })

  it("logs a replay failure that wrote nothing by its cause, not its wrapper's message", async () => {
    actions.start.mockRejectedValue(replayFailure('transaction'))
    expect(await rerun()).toStrictEqual({ step: 'refused' })
    expect(logError).toHaveBeenCalledExactlyOnceWith('app.close_rerun_start_threw', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      error: 'Error: UNIQUE constraint failed',
    })
    expect(actions.load).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.startFailed'))
  })
})

describe('runCloseRerun — a shortcut that landed and failed its store sync', () => {
  it('re-hydrates the branch while it stays open, and toasts that the re-run did not start', async () => {
    currentStoryStore.set(story('br_1'))
    actions.start.mockRejectedValue(replayFailure('store-sync'))
    actions.load.mockResolvedValue({ status: 'ok', storyId: 'story_1', branchId: 'br_1' })

    expect(await rerun()).toStrictEqual({ step: 'refused' })

    expect(logWarn).toHaveBeenCalledExactlyOnceWith('app.close_rerun_sync_failed', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      error: 'Error: UNIQUE constraint failed',
    })
    expect(logError).not.toHaveBeenCalled()
    expect(actions.load).toHaveBeenCalledExactlyOnceWith(
      'br_1',
      { db: expect.anything(), runInTransaction: expect.any(Function) },
      expect.any(Function),
    )
    const stillOpen = actions.load.mock.calls[0]?.[2] as () => boolean
    expect(stillOpen()).toBe(true)
    currentStoryStore.set(story('br_2'))
    expect(stillOpen()).toBe(false)
    expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.startFailed'))
  })

  it('toasts nothing more when the branch was left before the re-hydration read', async () => {
    actions.start.mockRejectedValue(replayFailure('store-sync'))
    actions.load.mockResolvedValue({ status: 'cancelled' })

    expect(await rerun()).toStrictEqual({ step: 'refused' })

    expect(logError).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.startFailed'))
  })

  it.each([
    ['throws', () => Promise.reject(new Error('disk')), 'disk'],
    [
      'reads a corrupt story',
      () => Promise.resolve({ status: 'failed', kind: 'settings-corrupt' }),
      'branch re-hydration failed',
    ],
    [
      'finds no story',
      () => Promise.resolve({ status: 'no-story' }),
      'branch re-hydration no-story',
    ],
  ] as const)(
    'logs and toasts a re-hydration that %s, saying the story needs reopening',
    async (_name, load, message) => {
      actions.start.mockRejectedValue(replayFailure('store-sync'))
      actions.load.mockImplementation(load)

      expect(await rerun()).toStrictEqual({ step: 'refused' })

      expect(logError).toHaveBeenCalledExactlyOnceWith('app.close_rerun_resync_failed', {
        branchId: 'br_1',
        chapterId: 'chap_2',
        error: message,
      })
      expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.resyncFailed'))
    },
  )
})

describe('runCloseRerunOnBranch', () => {
  const SHORTCUT: CloseRerunShortcut = {
    targetEntryId: 'entry_58',
    forkPoint: { entryId: 'entry_57', position: 57 },
    turns: 7,
    entries: { count: 15, first: 58, last: 72 },
    counts: COUNTS,
  }
  const ON_PARENT: CloseRerunForkPreview = { ...PREVIEW, branchName: 'Main', shortcut: SHORTCUT }
  const CLEAR: CloseRerunParentCheck = {
    status: 'clear',
    preview: { ...ON_PARENT, shortcut: SHORTCUT },
  }
  const CTX = { db, runInTransaction: expect.any(Function) }
  const AT = { branchId: 'br_1', chapterId: 'chap_2' }
  const START_FAILED =
    'Branched "Ch. 2 re-run" from entry 57, but couldn\'t start the re-run. Retry from Chapter Timeline.'
  const NOT_OPENED =
    'Branched "Ch. 2 re-run" from entry 57, but couldn\'t open it. Switch to it, then retry from Chapter Timeline.'

  const replaceStack = vi.fn<ReplaceStoryStack>(() => true)
  const closeRequest = vi.fn<() => void>()
  const onBranch = () =>
    runCloseRerunOnBranch({
      storyId: 'story_1',
      branchId: 'br_1',
      chapterId: 'chap_2',
      preview: ON_PARENT,
      replaceStack,
      closeRequest,
    })

  let order: string[]
  let pendingAtFork: number[]
  let heldAt: Record<string, boolean>

  type Logged = readonly ['warn' | 'error', string, Readonly<Record<string, string>>]

  // One log for the event: a refusal warns, a throw is an error.
  function expectLoggedOnce([level, kind, detail]: Logged): void {
    const [used, unused] = level === 'warn' ? [logWarn, logError] : [logError, logWarn]
    expect(used).toHaveBeenCalledExactlyOnceWith(kind, {
      ...AT,
      newBranchId: 'br_child',
      ...detail,
    })
    expect(unused).not.toHaveBeenCalled()
  }

  function expectNothingAfterTheCheck(): void {
    expect(actions.show).not.toHaveBeenCalled()
    expect(branchList.refresh).not.toHaveBeenCalled()
    expect(actions.startOnFork).not.toHaveBeenCalled()
    expect(closeRequest).not.toHaveBeenCalled()
    expect(readerHoldStore.isHeld('br_1')).toBe(false)
  }

  beforeEach(() => {
    currentStoryStore.set(story('br_1'))
    order = []
    pendingAtFork = []
    heldAt = {}
    actions.check.mockReset().mockImplementation(async () => {
      order.push('check')
      heldAt.check = readerHoldStore.isHeld('br_1')
      return CLEAR
    })
    actions.fork.mockReset().mockImplementation(async () => {
      order.push('fork')
      heldAt.fork = readerHoldStore.isHeld('br_1')
      pendingAtFork.push(generationStore.getTxState().pendingTurns.size)
      return { status: 'ok', branchId: 'br_child' }
    })
    actions.show.mockReset().mockImplementation(async () => {
      order.push('show')
      heldAt.show = readerHoldStore.isHeld('br_1')
      return { status: 'ok' }
    })
    branchList.refresh.mockReset().mockImplementation(async () => {
      order.push('refresh')
    })
    actions.startOnFork.mockReset().mockImplementation(async (_branch, _chapter, _ctx, opts) => {
      order.push('start')
      opts?.onStarted?.()
      return END.committed
    })
    replaceStack.mockClear()
    closeRequest.mockReset()
  })

  it('types every step before the commit as a refusal: the check ends no chain', () => {
    type Step = Awaited<ReturnType<typeof runCloseRerunOnBranch>>
    expectTypeOf<Extract<Step, { step: 'ended' }>>().toBeNever()
  })

  it("takes the parent reader's hold before its first await and keeps it to the tail", async () => {
    const run = onBranch()
    expect(readerHoldStore.isHeld('br_1')).toBe(true)
    await run
    expect(heldAt).toStrictEqual({ check: true, fork: true, show: true })
    expect(readerHoldStore.isHeld('br_1')).toBe(false)
  })

  it('ends the hold when a step past its own catches throws', async () => {
    actions.check.mockRejectedValue(new Error('disk'))
    error.mockImplementation(() => {
      throw new Error('toast broke')
    })
    await expect(onBranch()).rejects.toThrow('toast broke')
    expect(readerHoldStore.isHeld('br_1')).toBe(false)
  })

  it('checks the parent, forks at N under the auto-name, shows the new branch through the stack reset, then refreshes and starts there', async () => {
    expect(await onBranch()).toStrictEqual({ step: 'forked' })
    expect(order).toStrictEqual(['check', 'fork', 'show', 'refresh', 'start'])
    expect(actions.check).toHaveBeenCalledExactlyOnceWith(
      'br_1',
      'chap_2',
      expectedOf(ON_PARENT),
      CTX,
    )
    expect(actions.fork).toHaveBeenCalledExactlyOnceWith(
      { parentBranchId: 'br_1', forkEntryId: 'entry_57', name: 'Ch. 2 re-run', makeCurrent: true },
      CTX,
    )
    expect(actions.show).toHaveBeenCalledExactlyOnceWith(
      {
        storyId: 'story_1',
        branchId: 'br_child',
        hold: expect.objectContaining({ branchId: 'br_1' }),
        replaceStack,
      },
      CTX,
    )
    expect(branchList.refresh).toHaveBeenCalledExactlyOnceWith(db, 'story_1')
    expect(actions.startOnFork).toHaveBeenCalledExactlyOnceWith('br_child', 'chap_2', CTX, {
      onStarted: expect.any(Function),
    })
    expect(closeRequest).not.toHaveBeenCalled()
    expect(warning).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it("forks at the check's fresh N, not the one the confirm showed", async () => {
    const fresh = { ...SHORTCUT, forkPoint: { entryId: 'entry_56', position: 56 } }
    actions.check.mockResolvedValue({ status: 'clear', preview: { ...ON_PARENT, shortcut: fresh } })
    await onBranch()
    expect(actions.fork).toHaveBeenCalledWith(
      expect.objectContaining({ forkEntryId: 'entry_56' }),
      CTX,
    )
    expect(info).toHaveBeenCalledExactlyOnceWith(
      t('chapters:rerunNotice.forkStarted', { name: 'Ch. 2 re-run', position: 56, number: 2 }),
    )
  })

  it.each([
    [
      'the start on it refuses',
      () =>
        actions.startOnFork.mockResolvedValue({
          outcome: 'rejected',
          blockedBy: MANUAL_CLOSE_REFUSAL.busy,
        }),
      'Branched "Ch. 2 re-run" from entry 56, but couldn\'t start the re-run. Retry from Chapter Timeline.',
    ],
    [
      "the tail can't navigate to it",
      () => actions.show.mockResolvedValue({ status: 'navigation-blocked' }),
      'Branched "Ch. 2 re-run" from entry 56, but couldn\'t open it. Switch to it, then retry from Chapter Timeline.',
    ],
  ] as const)(
    "warns at the check's fresh N, not the confirm's, when %s",
    async (_name, fail, message) => {
      const fresh = { ...SHORTCUT, forkPoint: { entryId: 'entry_56', position: 56 } }
      actions.check.mockResolvedValue({
        status: 'clear',
        preview: { ...ON_PARENT, shortcut: fresh },
      })
      fail()
      expect(await onBranch()).toStrictEqual({ step: 'forked' })
      expect(warning).toHaveBeenCalledExactlyOnceWith(message)
    },
  )

  it('holds no pending turn at the fork', async () => {
    await onBranch()
    expect(pendingAtFork).toStrictEqual([0])
  })

  it('names the branch as the toast does, and toasts the start only at its reserve', async () => {
    const started = deferred<CloseRerunForkStart>()
    actions.startOnFork.mockImplementation(() => started.promise)
    const run = onBranch()
    await vi.waitFor(() => expect(actions.startOnFork).toHaveBeenCalledTimes(1))
    expect(info).not.toHaveBeenCalled()

    actions.startOnFork.mock.calls[0]?.[3]?.onStarted?.()
    const { name } = actions.fork.mock.calls[0]?.[0] as ForkBranchInput
    expect(name).toBe(t('chapters:rerunConfirm.autoName', { number: 2 }))
    expect(info).toHaveBeenCalledExactlyOnceWith(
      'Branched "Ch. 2 re-run" from entry 57 — re-running chapter 2\'s close.',
    )
    expect(info).toHaveBeenCalledWith(
      t('chapters:rerunNotice.forkStarted', { name, position: 57, number: 2 }),
    )

    started.resolve(END.committed)
    expect(await run).toStrictEqual({ step: 'forked' })
    expect(info).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['cancelled', END.aborted, 'info', t('chapters:rerunNotice.cancelled', { number: 2 })],
    [
      'failed',
      END.failed,
      'warning',
      t('chapters:rerunNotice.failedWithReason', { number: 2, reason: 'socket hang up' }),
    ],
    ['undone', END.abortedUndone, 'warning', t('chapters:rerunNotice.undone', { number: 2 })],
  ] as const)(
    'toasts a re-run that ended %s as in place',
    async (_name, end, severity, message) => {
      actions.startOnFork.mockImplementation(async (_branch, _chapter, _ctx, opts) => {
        opts?.onStarted?.()
        return end
      })
      expect(await onBranch()).toStrictEqual({ step: 'forked' })
      expect({ info, warning, error }[severity]).toHaveBeenLastCalledWith(message)
    },
  )

  it('logs a refresh that rejects, toasts nothing for it, and still starts', async () => {
    branchList.refresh.mockRejectedValue(new Error('disk'))
    expect(await onBranch()).toStrictEqual({ step: 'forked' })
    await vi.waitFor(() =>
      expect(logWarn).toHaveBeenCalledExactlyOnceWith('app.branches_refresh_failed', {
        storyId: 'story_1',
        error: 'disk',
      }),
    )
    expect(actions.startOnFork).toHaveBeenCalledTimes(1)
    expect(warning).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it("starts without waiting on the refresh's read", async () => {
    branchList.refresh.mockReturnValue(new Promise(() => {}))
    expect(await onBranch()).toStrictEqual({ step: 'forked' })
    expect(actions.startOnFork).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'a busy story',
      { outcome: 'rejected', blockedBy: MANUAL_CLOSE_REFUSAL.busy },
      { step: 'keep-open' },
      'Unavailable while generating.',
      null,
    ],
    [
      'another branch open',
      { outcome: 'rejected', blockedBy: MANUAL_CLOSE_REFUSAL.branchNotOpen },
      { step: 'refused' },
      t('chapters:rerunNotice.startFailed'),
      MANUAL_CLOSE_REFUSAL.branchNotOpen,
    ],
    [
      'a pending swap',
      { outcome: 'rejected', blockedBy: MANUAL_CLOSE_REFUSAL.swapPending },
      { step: 'refused' },
      t('reader:actions.blockedWhileSwapping'),
      MANUAL_CLOSE_REFUSAL.swapPending,
    ],
    [
      'a branch held until a restart',
      { outcome: 'rejected', blockedBy: RERUN_HELD },
      { step: 'refused' },
      t('generationGate.rerunHeld'),
      RERUN_HELD,
    ],
    [
      'a chapter no longer the latest',
      { status: 'rejected', code: CLOSE_RERUN_REFUSAL.notLatest, reason: 'x' },
      { step: 'refused' },
      t('chapters:rerunConfirm.notLatest'),
      null,
    ],
    [
      'counts that moved',
      { status: 'rejected', code: 'counts-changed', reason: 'x', preview: FRESH },
      { step: 'replace', preview: FRESH },
      t('chapters:rerunNotice.countsChanged'),
      null,
    ],
  ] as const)(
    'refuses %s on the parent as the in-place start does, before any fork',
    async (_name, refusal, step, message, code) => {
      actions.check.mockResolvedValue(refusal)
      expect(await onBranch()).toStrictEqual(step)
      expect(error).toHaveBeenCalledExactlyOnceWith(message)
      if (code == null) expect(logWarn).not.toHaveBeenCalled()
      else
        expect(logWarn).toHaveBeenCalledExactlyOnceWith('app.close_rerun_start_refused', {
          ...AT,
          code,
        })
      expect(actions.fork).not.toHaveBeenCalled()
      expectNothingAfterTheCheck()
    },
  )

  it.each([
    [FORK_REFUSAL.gated, { step: 'keep-open' }, 'Unavailable while generating.', false],
    [
      FORK_REFUSAL.swapPending,
      { step: 'refused' },
      'Unavailable while the embedder switch finishes.',
      false,
    ],
    [
      FORK_REFUSAL.unfinishedRun,
      { step: 'refused' },
      "Memory work on this branch never finished, so it can't branch here yet. Restart the app, then try again.",
      true,
    ],
    [FORK_REFUSAL.entryMissing, { step: 'refused' }, "Couldn't start the re-run.", true],
    [FORK_REFUSAL.entrySystem, { step: 'refused' }, "Couldn't start the re-run.", true],
    [FORK_REFUSAL.rollbackFloor, { step: 'refused' }, "Couldn't start the re-run.", true],
    [FORK_REFUSAL.integrity, { step: 'refused' }, "Couldn't start the re-run.", true],
    ['lock-timeout', { step: 'refused' }, "Couldn't start the re-run.", true],
  ] as const)(
    'maps the fork refusing %s onto the confirm, and runs nothing after it',
    async (code, step, message, logged) => {
      actions.fork.mockResolvedValue({ status: 'rejected', code, reason: 'x' })
      expect(await onBranch()).toStrictEqual(step)
      expect(error).toHaveBeenCalledExactlyOnceWith(message)
      if (logged)
        expect(logWarn).toHaveBeenCalledExactlyOnceWith('app.close_rerun_fork_refused', {
          ...AT,
          code,
        })
      else expect(logWarn).not.toHaveBeenCalled()
      expectNothingAfterTheCheck()
    },
  )

  it.each([
    ['check', () => actions.check.mockRejectedValue(new Error('disk')), 0],
    ['fork', () => actions.fork.mockRejectedValue(new Error('disk')), 1],
  ] as const)(
    'logs a %s that throws and toasts start-failed; no branch exists',
    async (step, fail, forks) => {
      fail()
      expect(await onBranch()).toStrictEqual({ step: 'refused' })
      expect(logError).toHaveBeenCalledExactlyOnceWith('app.close_rerun_fork_threw', {
        ...AT,
        step,
        error: 'disk',
      })
      expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.startFailed'))
      expect(actions.fork).toHaveBeenCalledTimes(forks)
      expectNothingAfterTheCheck()
    },
  )

  it("on a tail that can't navigate, refreshes the list, closes the request, warns and starts nothing", async () => {
    actions.show.mockResolvedValue({ status: 'navigation-blocked' })
    expect(await onBranch()).toStrictEqual({ step: 'forked' })
    expect(branchList.refresh).toHaveBeenCalledExactlyOnceWith(db, 'story_1')
    expect(closeRequest).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledExactlyOnceWith(NOT_OPENED)
    expect(logWarn).toHaveBeenCalledExactlyOnceWith('app.close_rerun_fork_not_opened', {
      ...AT,
      newBranchId: 'br_child',
    })
    expect(actions.startOnFork).not.toHaveBeenCalled()
    expect(actions.show).toHaveBeenCalledTimes(1)
    expect(info).not.toHaveBeenCalled()
    expect(readerHoldStore.isHeld('br_1')).toBe(false)
  })

  it.each([
    [
      'navigated with nothing loaded',
      () => actions.show.mockResolvedValue({ status: 'shown-unloaded' }),
      ['warn', 'app.close_rerun_fork_start_failed', { cause: 'shown-unloaded' }],
    ],
    [
      'threw',
      () => actions.show.mockRejectedValue(new Error('disk')),
      ['error', 'app.close_rerun_fork_threw', { step: 'show', error: 'disk' }],
    ],
  ] as const)(
    'after the commit, a tail that %s starts nothing, closes the request and warns',
    async (_name, fail, logged) => {
      fail()
      expect(await onBranch()).toStrictEqual({ step: 'forked' })
      expect(actions.show).toHaveBeenCalledTimes(1)
      expect(branchList.refresh).toHaveBeenCalledExactlyOnceWith(db, 'story_1')
      expect(closeRequest).toHaveBeenCalledTimes(1)
      expect(warning).toHaveBeenCalledExactlyOnceWith(START_FAILED)
      expectLoggedOnce(logged)
      expect(actions.startOnFork).not.toHaveBeenCalled()
      expect(readerHoldStore.isHeld('br_1')).toBe(false)
    },
  )

  it.each([
    [
      'refuses with turns after the close',
      () =>
        actions.startOnFork.mockResolvedValue({
          status: 'rejected',
          code: CLOSE_RERUN_TURNS_FOLLOWED,
          reason: 'x',
        }),
      ['warn', 'app.close_rerun_fork_start_failed', { cause: 'turns-followed' }],
    ],
    [
      'refuses a busy story',
      () =>
        actions.startOnFork.mockResolvedValue({
          outcome: 'rejected',
          blockedBy: MANUAL_CLOSE_REFUSAL.busy,
        }),
      ['warn', 'app.close_rerun_fork_start_failed', { cause: 'story-busy' }],
    ],
    [
      'throws',
      () => actions.startOnFork.mockRejectedValue(new Error('disk')),
      ['error', 'app.close_rerun_fork_threw', { step: 'start', error: 'disk' }],
    ],
  ] as const)(
    'a start on the new branch that %s ends the sequence with the warning',
    async (_name, fail, logged) => {
      fail()
      expect(await onBranch()).toStrictEqual({ step: 'forked' })
      expect(warning).toHaveBeenCalledExactlyOnceWith(START_FAILED)
      expectLoggedOnce(logged)
      expect(info).not.toHaveBeenCalled()
      // The tail ran once and published, so its prune, not the sequence, closes the confirm.
      expect(actions.show).toHaveBeenCalledTimes(1)
      expect(closeRequest).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['switched to another branch', () => currentStoryStore.set(story('br_2')), true],
    ['closed', () => currentStoryStore.clear(), false],
    [
      'left for another story',
      () => currentStoryStore.set({ ...story('br_9'), storyId: 'story_2' }),
      false,
    ],
  ] as const)(
    "after the commit, with the story %s, skips the tail, closes the request and warns it wasn't opened",
    async (_name, leave, refreshes) => {
      actions.fork.mockImplementation(async () => {
        leave()
        return { status: 'ok', branchId: 'br_child' }
      })
      expect(await onBranch()).toStrictEqual({ step: 'forked' })
      expect(actions.show).not.toHaveBeenCalled()
      // The list store holds one story: only this story, still open, is refreshed.
      if (refreshes) expect(branchList.refresh).toHaveBeenCalledExactlyOnceWith(db, 'story_1')
      else expect(branchList.refresh).not.toHaveBeenCalled()
      expect(closeRequest).toHaveBeenCalledTimes(1)
      expect(warning).toHaveBeenCalledExactlyOnceWith(NOT_OPENED)
      expect(logWarn).toHaveBeenCalledExactlyOnceWith('app.close_rerun_fork_not_opened', {
        ...AT,
        newBranchId: 'br_child',
        cause: 'story-left',
      })
      expect(actions.startOnFork).not.toHaveBeenCalled()
      expect(readerHoldStore.isHeld('br_1')).toBe(false)
    },
  )
})
