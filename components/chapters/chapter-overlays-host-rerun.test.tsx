// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CloseRerunPreview } from '@/lib/actions'
import { createQueryClient } from '@/lib/cache'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import {
  STORY_SETTINGS_DEFAULTS,
  storyDefinitionSchema,
  type CloseReport,
  type Delta,
} from '@/lib/db'
import type { CloseReview } from '@/lib/history'
import { t } from '@/lib/i18n'
import { CHAPTER_CLOSE_KIND, type ChainEnd } from '@/lib/pipeline'
import {
  chapterOverlaysStore,
  chaptersStore,
  currentStoryStore,
  generationStore,
  resetAllStores,
  type OpenStory,
  type RunState,
  type StoreChapter,
} from '@/lib/stores'
import { toast, toastStore } from '@/lib/toast'

import { ChapterOverlaysHost } from './chapter-overlays-host'
import type { CloseRerunConfirmProps } from './close-rerun-confirm'
import type { ReviewWindowProps } from './review-window'

const reads = vi.hoisted(() => ({
  report: vi.fn(),
  deltas: vi.fn(),
  kinds: vi.fn(),
  build: vi.fn(),
  series: vi.fn(),
}))

// The runtime `db` is a bridge client; the host only passes it to the mocked reads.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
  openRegionSeries: reads.series,
}))

// The close-failure copy's module also holds a hook on expo-router, which the unit project can't load.
vi.mock('expo-router', () => ({ useRouter: () => ({}) }))

vi.mock('@/lib/history', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readCloseReport: reads.report,
  loadCloseDeltas: reads.deltas,
  readDeletedEntityKinds: reads.kinds,
  buildCloseReview: reads.build,
}))

const actions = vi.hoisted(() => ({ preview: vi.fn(), start: vi.fn() }))
vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCloseRerunPreview: actions.preview,
  startCloseRerun: actions.start,
}))

vi.mock('@/hooks/use-surface-navigate', () => ({ useSurfaceNavigate: () => vi.fn() }))

vi.mock('@/hooks/use-entry-index', () => ({
  useEntryIndex: () => ({
    entries: [],
    index: new Map(),
    ready: true,
    failed: false,
    updating: false,
    retry: () => {},
  }),
}))

// The real views pull RN-Web chrome the unit project can't load; the host's props are the seam.
const view = vi.hoisted(() => ({
  props: null as ReviewWindowProps | null,
  phone: false,
}))
vi.mock('@/hooks/use-tier', () => ({ useTier: () => (view.phone ? 'phone' : 'desktop') }))
vi.mock('./review-window', async () => {
  const { useEffect } = await import('react')
  return {
    ReviewWindow: (props: ReviewWindowProps) => {
      view.props = props
      // The real window: above phone its exit ends as it closes; on phone the Sheet reports it.
      const { open, onExited, onPresented } = props
      useEffect(() => {
        if (!open && !view.phone) onExited?.()
      }, [open, onExited])
      useEffect(() => {
        if (open && view.phone) onPresented?.()
      }, [open, onPresented])
      return null
    },
  }
})

const confirmView = vi.hoisted(() => ({
  props: null as CloseRerunConfirmProps | null,
  mounted: false,
}))
vi.mock('./close-rerun-confirm', async () => {
  const { useEffect } = await import('react')
  return {
    CloseRerunConfirm: (props: CloseRerunConfirmProps) => {
      confirmView.props = props
      useEffect(() => {
        confirmView.mounted = true
        return () => {
          confirmView.mounted = false
        }
      }, [])
      return null
    },
  }
})
vi.mock('./close-chapter-modal-view', () => ({ CloseChapterModalView: () => null }))

const REPORT: CloseReport = {
  version: 1,
  actionId: 'act_close_2',
  calls: [],
  stopped: [],
  noToolCalls: false,
}

const DELTAS: Delta[] = []

const REVIEW: CloseReview = { stopped: [], noToolCalls: false, notApplied: [], changes: [] }

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

// A branch switch or reload republishes the open; it isn't a new open of the story.
function openStory(branchId = 'br_1'): void {
  currentStoryStore.set(story(branchId))
}

function settleRun(): void {
  const run: RunState = {
    runId: 'run_settle',
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_settle',
    storyId: 'story_1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
  act(() => generationStore.startRun(run))
  act(() => generationStore.finishRun(run.runId))
}

function renderHost() {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ChapterOverlaysHost />
    </QueryClientProvider>,
  )
}

function shown(): ReviewWindowProps {
  if (view.props == null) throw new Error('the review window is not rendered')
  return view.props
}

function openWindow(chapterId = 'chap_2'): void {
  act(() => chapterOverlaysStore.openReviewWindow({ chapterId }))
}

async function openReady(): Promise<ReviewWindowProps> {
  renderHost()
  openWindow()
  await waitFor(() => expect(view.props?.state.status).toBe('ready'))
  return shown()
}

function chapter(over: Partial<StoreChapter> = {}): StoreChapter {
  return {
    id: 'chap_2',
    branchId: 'br_1',
    sequenceNumber: 2,
    title: 'The Keep Leans Closer',
    summary: '',
    theme: '',
    keywords: [],
    startEntryId: 'entry_40',
    endEntryId: 'entry_58',
    tokenCount: 0,
    closedAt: 1,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    hasCloseReport: true,
    closeReportActionId: 'act_close_2',
    ...over,
  }
}

const PREVIEW: CloseRerunPreview = {
  chapterNumber: 2,
  model: 'gemma-4-26b',
  tokens: 24_310,
  reversal: { createdLore: { count: 2, userEdited: true }, otherChanges: 31 },
  shortcut: null,
}

const FRESH: CloseRerunPreview = {
  ...PREVIEW,
  reversal: { createdLore: { count: 3, userEdited: true }, otherChanges: 31 },
}

const RUN = { runId: 'run_rerun', actionId: 'act_rerun_2' }
const END = {
  committed: {
    kind: CHAPTER_CLOSE_KIND,
    result: { ...RUN, outcome: 'completed' },
    cancelled: false,
  },
  aborted: { kind: CHAPTER_CLOSE_KIND, result: { ...RUN, outcome: 'aborted' } },
  failed: {
    kind: CHAPTER_CLOSE_KIND,
    result: {
      ...RUN,
      outcome: 'failed',
      error: { kind: 'provider', reason: 'network', detail: 'socket hang up' },
    },
  },
  undone: {
    kind: CHAPTER_CLOSE_KIND,
    result: { ...RUN, outcome: 'aborted', closeUndone: true },
  },
  passFailed: {
    kind: PERIODIC_CLASSIFIER_KIND,
    result: { ...RUN, outcome: 'failed', error: { kind: 'orchestrator', detail: 'x' } },
  },
} as const satisfies Record<string, ChainEnd>

function gateRun(): RunState {
  return {
    runId: 'run_gate',
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_gate',
    storyId: 'story_1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

function openRerun(input: { fromReview?: boolean } = {}): void {
  act(() =>
    chapterOverlaysStore.openRerunConfirm({ branchId: 'br_1', chapterId: 'chap_2', ...input }),
  )
}

async function confirmShown(): Promise<CloseRerunConfirmProps> {
  await waitFor(() => expect(confirmView.mounted).toBe(true))
  if (confirmView.props == null) throw new Error('the re-run confirm is not rendered')
  return confirmView.props
}

// A Send's pending mark on the branch, held until `end`.
function markPendingTurn(): { end: () => Promise<void> } {
  let release: () => void = () => {}
  const body = new Promise<void>((resolve) => {
    release = resolve
  })
  let marked: Promise<void> = Promise.resolve()
  act(() => {
    marked = generationStore.bracketPendingTurn('br_1', () => body)
  })
  return {
    end: () =>
      act(async () => {
        release()
        await marked
      }),
  }
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  resetAllStores()
  view.props = null
  view.phone = false
  reads.report.mockReset().mockResolvedValue(REPORT)
  reads.deltas.mockReset().mockResolvedValue(DELTAS)
  reads.kinds.mockReset().mockResolvedValue(new Map())
  reads.build.mockReset().mockReturnValue(REVIEW)
  reads.series.mockReset().mockResolvedValue([])
  confirmView.props = null
  confirmView.mounted = false
  actions.preview.mockReset().mockResolvedValue(PREVIEW)
  actions.start.mockReset()
  openStory()
  chaptersStore.hydrate('br_1', [chapter()])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChapterOverlaysHost — the re-run confirm', () => {
  function surfaceWith(guard: (proceed: () => void) => void): void {
    chapterOverlaysStore.registerSurface({ guard, navigate: vi.fn<(path: string) => void>() })
  }

  it('from the card runs the guard, then reads the preview and opens the confirm', async () => {
    const guard = vi.fn<(proceed: () => void) => void>()
    surfaceWith(guard)
    renderHost()
    openRerun()
    expect(guard).toHaveBeenCalledTimes(1)
    expect(actions.preview).not.toHaveBeenCalled()

    act(() => guard.mock.calls[0]![0]())
    const props = await confirmShown()
    expect(actions.preview).toHaveBeenCalledExactlyOnceWith(
      'br_1',
      'chap_2',
      expect.objectContaining({ branchId: 'br_1' }),
      { db: {}, runInTransaction: expect.any(Function) },
    )
    expect(props).toMatchObject({ open: true, preview: PREVIEW, pending: false })
    expect(props.blockedReason).toBeUndefined()
    expect(chapterOverlaysStore.getState().review).toBeNull()
  })

  it("over a dirty surface, Re-run… closes the window before the guard asks, and the guard's Cancel opens nothing", async () => {
    const seen: unknown[] = []
    const guard = vi.fn<(proceed: () => void) => void>(() => {
      seen.push(chapterOverlaysStore.getState().review)
    })
    surfaceWith(guard)
    await openReady()
    openRerun({ fromReview: true })
    expect(seen).toEqual([null])
    expect(shown().open).toBe(false)
    await flush()
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(confirmView.mounted).toBe(false)
    expect(actions.preview).not.toHaveBeenCalled()
  })

  it("Discard opens the confirm alone, and the confirm's Cancel reopens the window", async () => {
    const guard = vi.fn<(proceed: () => void) => void>()
    surfaceWith(guard)
    await openReady()
    openRerun({ fromReview: true })
    act(() => guard.mock.calls[0]![0]())
    const props = await confirmShown()
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(shown().open).toBe(false)

    act(() => props.onCancel())
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(confirmView.mounted).toBe(false)
    expect(chapterOverlaysStore.getState().review).toStrictEqual({
      chapterId: 'chap_2',
      actionId: 'act_close_2',
    })
    expect(shown().open).toBe(true)
  })

  it("on phone, the confirm's Cancel during the window's slide-out reopens it after the exit", async () => {
    view.phone = true
    const guard = vi.fn<(proceed: () => void) => void>()
    surfaceWith(guard)
    await openReady()
    openRerun({ fromReview: true })
    act(() => guard.mock.calls[0]![0]())
    const props = await confirmShown()

    act(() => props.onCancel())
    expect(chapterOverlaysStore.getState().review).not.toBeNull()
    expect(shown().open).toBe(false)
    act(() => shown().onExited?.())
    expect(shown().open).toBe(true)
  })

  it("from the card, the confirm's Cancel opens no window", async () => {
    renderHost()
    openRerun()
    const props = await confirmShown()
    act(() => props.onCancel())
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(chapterOverlaysStore.getState().review).toBeNull()
  })

  it('confirming leaves a remembered window closed', async () => {
    let release: (end: ChainEnd) => void = () => {}
    actions.start.mockImplementation(
      () =>
        new Promise<ChainEnd>((resolve) => {
          release = resolve
        }),
    )
    await openReady()
    openRerun({ fromReview: true })
    const props = await confirmShown()
    act(() => props.onConfirm())
    act(() => actions.start.mock.calls[0]?.[5]?.onStarted?.())
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(chapterOverlaysStore.getState().review).toBeNull()
    await act(async () => release(END.committed))
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(actions.start).toHaveBeenCalledExactlyOnceWith(
      'br_1',
      'chap_2',
      { shortcut: null, reversal: PREVIEW.reversal },
      expect.objectContaining({ branchId: 'br_1' }),
      { db: {}, runInTransaction: expect.any(Function) },
      { onStarted: expect.any(Function) },
    )
  })

  it('a Cancel pressed before the confirm re-renders pending is ignored', async () => {
    actions.start.mockImplementation(() => new Promise<ChainEnd>(() => {}))
    await openReady()
    openRerun({ fromReview: true })
    const props = await confirmShown()
    act(() => {
      props.onConfirm()
      props.onCancel()
    })
    expect(chapterOverlaysStore.getState().rerunConfirm).not.toBeNull()
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(confirmView.props?.pending).toBe(true)
  })

  it('a branch switch drops the request, and the window it closed reopens on neither branch', async () => {
    await openReady()
    openRerun({ fromReview: true })
    await confirmShown()
    act(() => openStory('br_2'))
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(confirmView.mounted).toBe(false)
    expect(chapterOverlaysStore.getState().review).toBeNull()

    act(() => openStory('br_1'))
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(confirmView.mounted).toBe(false)
    expect(actions.start).not.toHaveBeenCalled()
  })

  it('a story close drops the request', async () => {
    renderHost()
    openRerun()
    await confirmShown()
    act(() => currentStoryStore.clear())
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(confirmView.mounted).toBe(false)
  })

  it('a request dropped on its own branch leaves the window it closed closed', async () => {
    await openReady()
    openRerun({ fromReview: true })
    await confirmShown()
    act(() =>
      chaptersStore.patch('br_1', {
        op: 'create',
        id: 'chap_3',
        row: chapter({ id: 'chap_3', sequenceNumber: 3, closeReportActionId: 'act_close_3' }),
      }),
    )
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(shown().open).toBe(false)
  })

  it('drops the request once its chapter is no longer the latest', async () => {
    renderHost()
    openRerun()
    await confirmShown()
    act(() =>
      chaptersStore.patch('br_1', {
        op: 'create',
        id: 'chap_3',
        row: chapter({ id: 'chap_3', sequenceNumber: 3, closeReportActionId: 'act_close_3' }),
      }),
    )
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(confirmView.mounted).toBe(false)
  })

  it('a refused preview toasts and opens nothing', async () => {
    const show = vi.spyOn(toastStore, 'show')
    actions.preview.mockResolvedValue({ status: 'rejected', code: 'not-latest', reason: 'x' })
    renderHost()
    openRerun()
    await waitFor(() => expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull())
    expect(confirmView.mounted).toBe(false)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it("disables every button while the start runs, and closes once the re-run's chain holds the branch", async () => {
    let release: (end: ChainEnd) => void = () => {}
    actions.start.mockImplementation(
      () =>
        new Promise<ChainEnd>((resolve) => {
          release = resolve
        }),
    )
    const info = vi.spyOn(toast, 'info').mockReturnValue('')
    renderHost()
    openRerun()
    const props = await confirmShown()
    act(() => props.onConfirm())
    expect(confirmView.props?.pending).toBe(true)
    // A second press while the first is running starts nothing.
    act(() => confirmView.props?.onConfirm())
    expect(actions.start).toHaveBeenCalledTimes(1)

    // startCloseRerun's onStarted: the chain's first run reserved.
    act(() => actions.start.mock.calls[0]?.[5]?.onStarted?.())
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    expect(confirmView.mounted).toBe(false)

    await act(async () => release(END.aborted))
    expect(info).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.cancelled', { number: 2 }))
  })

  it.each([
    ['cancelled', END.aborted, 'info', t('chapters:rerunNotice.cancelled', { number: 2 })],
    [
      'failed',
      END.failed,
      'warning',
      t('chapters:rerunNotice.failedWithReason', { number: 2, reason: 'socket hang up' }),
    ],
    ['undone', END.undone, 'warning', t('chapters:rerunNotice.undone', { number: 2 })],
  ] as const)(
    "toasts the re-run's end, %s, and closes the confirm",
    async (_name, end, severity, message) => {
      const spy = vi.spyOn(toast, severity).mockReturnValue('')
      actions.start.mockResolvedValue(end)
      renderHost()
      openRerun()
      const props = await confirmShown()
      act(() => props.onConfirm())
      await waitFor(() => expect(spy).toHaveBeenCalledExactlyOnceWith(message))
      expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
    },
  )

  it("toasts nothing for a catch-up pass that ends the chain: the pass's own toast speaks", async () => {
    const show = vi.spyOn(toastStore, 'show')
    actions.start.mockResolvedValue(END.passFailed)
    renderHost()
    openRerun()
    const props = await confirmShown()
    act(() => props.onConfirm())
    await waitFor(() => expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull())
    expect(show).not.toHaveBeenCalled()
  })

  it('counts-changed keeps the confirm on the fresh preview, with its toast', async () => {
    const error = vi.spyOn(toast, 'error').mockReturnValue('')
    actions.start.mockResolvedValue({
      status: 'rejected',
      code: 'counts-changed',
      reason: 'x',
      preview: FRESH,
    })
    renderHost()
    openRerun()
    const props = await confirmShown()
    act(() => props.onConfirm())
    await waitFor(() => expect(confirmView.props?.preview).toBe(FRESH))
    expect(confirmView.props?.pending).toBe(false)
    expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunNotice.countsChanged'))
    expect(chapterOverlaysStore.getState().rerunConfirm).not.toBeNull()
  })

  it('starts on the open story as it stands at the press', async () => {
    actions.start.mockResolvedValue(END.committed)
    renderHost()
    openRerun()
    const props = await confirmShown()
    const live = { ...story('br_1'), settings: { ...STORY_SETTINGS_DEFAULTS } }
    act(() => currentStoryStore.set(live))
    act(() => props.onConfirm())
    await waitFor(() => expect(actions.start).toHaveBeenCalledTimes(1))
    expect(actions.start.mock.calls[0]?.[3]).toBe(live)
  })

  it('toasts a refusal that lands after its confirm has gone', async () => {
    let release: (start: unknown) => void = () => {}
    actions.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const error = vi.spyOn(toast, 'error').mockReturnValue('')
    renderHost()
    openRerun()
    const props = await confirmShown()
    act(() => props.onConfirm())
    act(() =>
      chaptersStore.patch('br_1', {
        op: 'create',
        id: 'chap_3',
        row: chapter({ id: 'chap_3', sequenceNumber: 3, closeReportActionId: 'act_close_3' }),
      }),
    )
    expect(confirmView.mounted).toBe(false)

    await act(async () => release({ status: 'rejected', code: 'not-latest', reason: 'x' }))
    expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunConfirm.notLatest'))
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
  })

  // startCloseRerun awaits the held check before its mark: a settle there is the start's to judge.
  it('re-reads nothing for a run settling while the start is in flight, so only its result speaks', async () => {
    let release: (start: unknown) => void = () => {}
    actions.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const error = vi.spyOn(toast, 'error').mockReturnValue('')
    renderHost()
    openRerun()
    const props = await confirmShown()
    act(() => props.onConfirm())
    actions.preview.mockResolvedValue({ status: 'rejected', code: 'not-latest', reason: 'x' })

    settleRun()
    await flush()
    expect(actions.preview).toHaveBeenCalledTimes(1)
    expect(confirmView.mounted).toBe(true)
    expect(error).not.toHaveBeenCalled()

    await act(async () => release({ status: 'rejected', code: 'not-latest', reason: 'x' }))
    expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunConfirm.notLatest'))
    expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull()
  })

  it('not-latest closes the confirm with its own toast', async () => {
    const error = vi.spyOn(toast, 'error').mockReturnValue('')
    actions.start.mockResolvedValue({ status: 'rejected', code: 'not-latest', reason: 'x' })
    renderHost()
    openRerun()
    const props = await confirmShown()
    act(() => props.onConfirm())
    await waitFor(() => expect(chapterOverlaysStore.getState().rerunConfirm).toBeNull())
    expect(error).toHaveBeenCalledExactlyOnceWith(t('chapters:rerunConfirm.notLatest'))
  })

  it('an in-flight refusal toasts and keeps the confirm open, its actions disabled while the story is busy', async () => {
    const error = vi.spyOn(toast, 'error').mockReturnValue('')
    actions.start.mockResolvedValue({ outcome: 'rejected', blockedBy: 'story-busy' })
    renderHost()
    openRerun()
    const props = await confirmShown()
    // A background run the gate lets through: the hold alone disables the actions.
    const pass = { ...gateRun(), runId: 'run_pass', gateBehavior: 'no-gate' as const }
    act(() => generationStore.startRun(pass))
    act(() => props.onConfirm())
    await waitFor(() =>
      expect(confirmView.props?.blockedReason).toBe(t('reader:actions.blockedWhileGenerating')),
    )
    expect(confirmView.props?.pending).toBe(false)
    expect(confirmView.mounted).toBe(true)
    expect(chapterOverlaysStore.getState().rerunConfirm).not.toBeNull()
    expect(error).toHaveBeenCalledExactlyOnceWith('Unavailable while generating.')

    // Another run's settle ends no blocker of this story's.
    settleRun()
    expect(confirmView.props?.blockedReason).toBe(t('reader:actions.blockedWhileGenerating'))
    act(() => generationStore.finishRun(pass.runId))
    expect(confirmView.props?.blockedReason).toBeUndefined()
  })

  // A Send refused before its run reserves: its mark ends with no run, so nothing settles.
  it('releases the in-flight hold when a pending turn ends with no run', async () => {
    actions.start.mockResolvedValue({ outcome: 'rejected', blockedBy: 'story-busy' })
    renderHost()
    openRerun()
    const props = await confirmShown()
    const send = markPendingTurn()
    const settled = generationStore.getSettleCount()
    act(() => props.onConfirm())
    await waitFor(() => expect(confirmView.props?.pending).toBe(false))
    expect(confirmView.props?.blockedReason).toBe(t('generationGate.inFlight'))

    await send.end()
    expect(generationStore.getSettleCount()).toBe(settled)
    expect(confirmView.props?.blockedReason).toBeUndefined()
  })

  it("disables the confirm's actions with the gate's reason while a run holds it", async () => {
    renderHost()
    openRerun()
    await confirmShown()
    const run = gateRun()
    act(() => generationStore.startRun(run))
    expect(confirmView.props?.blockedReason).toBe(t('generationGate.inFlight'))
    act(() => generationStore.finishRun(run.runId))
    expect(confirmView.props?.blockedReason).toBeUndefined()
  })
})
