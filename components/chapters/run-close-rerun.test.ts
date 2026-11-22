// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  CLOSE_RERUN_REFUSAL,
  MANUAL_CLOSE_REFUSAL,
  STORY_ENTRY_REJECTION,
  type CloseRerunPreview,
  type CloseRerunStart,
  type RollbackCounts,
} from '@/lib/actions'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { EMBEDDER_SWAP_REFUSAL } from '@/lib/embedder-swap'
import { t } from '@/lib/i18n'
import { CHAPTER_CLOSE_KIND, type ChainEnd, type PipelineError } from '@/lib/pipeline'
import type { OpenStory } from '@/lib/stores'
import { toast } from '@/lib/toast'

import { expectedOf, rerunEndNotice, rerunStartOutcome, runCloseRerun } from './run-close-rerun'

// The close-failure copy's module also holds a hook on expo-router, which the unit project can't load.
vi.mock('expo-router', () => ({ useRouter: () => ({}) }))

const actions = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startCloseRerun: actions.start,
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
  model: 'gemma-4-26b',
  tokens: 24_310,
  reversal: { createdLore: { count: 2, userEdited: true }, otherChanges: 31 },
  shortcut: {
    targetEntryId: 'entry_58',
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

const STORY: OpenStory = {
  storyId: 'story_1',
  branchId: 'br_1',
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

const rerun = () =>
  runCloseRerun({ branchId: 'br_1', chapterId: 'chap_2', preview: PREVIEW, story: STORY })

let info: MockInstance<typeof toast.info>
let warning: MockInstance<typeof toast.warning>
let error: MockInstance<typeof toast.error>
let logWarn: MockInstance<typeof logger.warn>
let logError: MockInstance<typeof logger.error>

beforeEach(() => {
  actions.start.mockReset()
  info = vi.spyOn(toast, 'info').mockReturnValue('')
  warning = vi.spyOn(toast, 'warning').mockReturnValue('')
  error = vi.spyOn(toast, 'error').mockReturnValue('')
  logWarn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  logError = vi.spyOn(logger, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
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
  ] as const)('speaks for a re-run %s', (_name, end, severity, message) => {
    expect(rerunEndNotice(end, 2)).toStrictEqual({ severity, message })
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

  it('closes on not-latest with its own copy, unlogged', () => {
    expect(
      rerunStartOutcome(
        { status: 'rejected', code: CLOSE_RERUN_REFUSAL.notLatest, reason: 'x' },
        2,
      ),
    ).toStrictEqual({
      step: { step: 'refused' },
      notice: { severity: 'error', message: t('chapters:rerunConfirm.notLatest') },
      logCode: null,
    })
  })

  it.each([
    ['no-close', { status: 'rejected', code: CLOSE_RERUN_REFUSAL.noClose, reason: 'x' }],
    ['close-owed', { status: 'rejected', code: CLOSE_RERUN_REFUSAL.closeOwed, reason: 'x' }],
    ['integrity', { status: 'rejected', code: CLOSE_RERUN_REFUSAL.integrity, reason: 'x' }],
    [EMBEDDER_SWAP_REFUSAL, { outcome: 'rejected', blockedBy: EMBEDDER_SWAP_REFUSAL }],
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
        story: STORY,
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
      STORY,
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
})
