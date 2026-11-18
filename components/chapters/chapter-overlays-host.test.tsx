// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/cache'
import {
  STORY_SETTINGS_DEFAULTS,
  storyDefinitionSchema,
  type CloseReport,
  type Delta,
  type Happening,
  type HappeningAwareness,
  type OpenRegionRow,
  type Thread,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { EntryRef } from '@/lib/entry-refs'
import type { CloseReview, CloseReviewChange, CloseReviewLookup } from '@/lib/history'
import { t } from '@/lib/i18n'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'
import type { PipelineError } from '@/lib/pipeline'
import {
  chapterOverlaysStore,
  chaptersStore,
  currentStoryStore,
  entitiesStore,
  generationStore,
  happeningAwarenessStore,
  happeningsStore,
  loreStore,
  resetAllStores,
  threadsStore,
  type OpenStory,
  type RunState,
  type StoreChapter,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

import { ChapterOverlaysHost } from './chapter-overlays-host'
import type { CloseChapterModalViewProps } from './close-chapter-modal-view'
import type { ReviewWindowProps } from './review-window'

const reads = vi.hoisted(() => ({
  report: vi.fn(),
  deltas: vi.fn(),
  kinds: vi.fn(),
  build: vi.fn(),
  series: vi.fn(),
  times: vi.fn(),
}))

// The runtime `db` is a bridge client; the host only passes it to the mocked reads.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
  openRegionSeries: reads.series,
}))

vi.mock('@/lib/entry-refs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readOpenRegionTimes: reads.times,
}))

const actions = vi.hoisted(() => ({ start: vi.fn(), raise: vi.fn() }))
vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startManualClose: actions.start,
  raiseSystemEntry: actions.raise,
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

const hostNavigate = vi.hoisted(() => vi.fn<(path: string) => void>())
vi.mock('@/hooks/use-surface-navigate', () => ({ useSurfaceNavigate: () => hostNavigate }))

// An external store, so a test can resolve the index under a mounted host.
const entryIndex = vi.hoisted(() => {
  const retry = vi.fn<() => void>()
  const READY = {
    entries: [],
    index: new Map<string, EntryRef>([
      [
        'entry_47',
        {
          id: 'entry_47',
          position: 47,
          kind: 'ai_reply' as const,
          chapterId: 'chap_2',
          excerpt: '',
        },
      ],
    ]),
    ready: true,
    failed: false,
    updating: false,
    retry,
  }
  type Snapshot = typeof READY
  const listeners = new Set<() => void>()
  let snapshot: Snapshot = READY
  return {
    retry,
    READY,
    PENDING: { ...READY, index: new Map(), ready: false } satisfies Snapshot,
    FAILED: { ...READY, index: new Map(), ready: false, failed: true } satisfies Snapshot,
    get: (): Snapshot => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next: Snapshot) => {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
})
vi.mock('@/hooks/use-entry-index', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useEntryIndex: () => useSyncExternalStore(entryIndex.subscribe, entryIndex.get),
  }
})

// The real view pulls RN-Web chrome the unit project can't load; the host's props are the seam.
const view = vi.hoisted(() => ({ props: null as ReviewWindowProps | null, renders: 0 }))
vi.mock('./review-window', () => ({
  ReviewWindow: (props: ReviewWindowProps) => {
    view.props = props
    view.renders += 1
    return null
  },
}))

// The close modal's view, stubbed the same way: its props are what the connected body hands it.
const modalView = vi.hoisted(() => ({
  props: null as CloseChapterModalViewProps | null,
  mounted: false,
  // What each render showed, so a test can see a frame that dropped the rows or their times.
  frames: [] as { replies: number; startTime: string | null }[],
}))
vi.mock('./close-chapter-modal-view', async () => {
  const { useEffect } = await import('react')
  return {
    CloseChapterModalView: (props: CloseChapterModalViewProps) => {
      modalView.props = props
      modalView.frames.push({ replies: props.replies.length, startTime: props.start?.time ?? null })
      useEffect(() => {
        modalView.mounted = true
        return () => {
          modalView.mounted = false
        }
      }, [])
      return null
    },
  }
})

const REPORT: CloseReport = {
  version: 1,
  actionId: 'act_close_2',
  calls: [
    {
      task: 'identity',
      part: 1,
      tool: 'update_character',
      rows: [{ table: 'entities', id: 'char_kael', name: 'Kael' }],
      why: 'He stops joking.',
      turns: ['entry_47'],
      result: 'ok',
      values: { description: 'A quiet man.' },
    },
    {
      task: 'upkeep',
      part: 1,
      tool: 'update_place',
      rows: [{ table: 'entities', id: 'loc_mill', name: 'Old Mill' }],
      why: 'The mill burned.',
      turns: ['entry_99'],
      result: 'ok',
      values: { description: 'Ash.' },
    },
    {
      task: 'lore',
      part: 1,
      tool: 'create_lore',
      rows: [{ table: 'lore', id: 'lore_tithe', name: 'The Tithe' }],
      why: 'Sael explains it.',
      turns: ['entry_47'],
      result: 'ok',
      values: { body: 'An hour a year.' },
    },
  ],
  stopped: [],
  noToolCalls: false,
}

const DELTAS: Delta[] = []

const KAEL: CloseReviewChange = {
  key: '0:char_kael:description',
  op: 'update',
  area: 'charactersAndFactions',
  target: { table: 'entities', id: 'char_kael', name: 'Kael' },
  fieldPath: 'description',
  fieldLabel: 'Description',
  summary: 'A quiet man.',
  why: 'He stops joking.',
  entryId: 'entry_47',
  pressTo: { table: 'entities', id: 'char_kael' },
}

const MILL: CloseReviewChange = {
  ...KAEL,
  key: '1:loc_mill:description',
  area: 'placesAndItems',
  target: { table: 'entities', id: 'loc_mill', name: 'Old Mill' },
  summary: 'Ash.',
  why: 'The mill burned.',
  entryId: 'entry_99',
  pressTo: { table: 'entities', id: 'loc_mill' },
}

const REVIEW: CloseReview = {
  stopped: [],
  noToolCalls: false,
  notApplied: [],
  changes: [
    { area: 'charactersAndFactions', rows: [KAEL] },
    { area: 'placesAndItems', rows: [MILL] },
  ],
}

// The open region after chapter 2: an action, then two turns; running totals 420, 720, 1000.
const SERIES: readonly OpenRegionRow[] = [
  { id: 'entry_59', kind: 'user_action', position: 59, tokens: 120 },
  { id: 'entry_60', kind: 'ai_reply', position: 60, tokens: 300 },
  { id: 'entry_61', kind: 'user_action', position: 61, tokens: 40 },
  { id: 'entry_62', kind: 'ai_reply', position: 62, tokens: 260 },
  { id: 'entry_63', kind: 'user_action', position: 63, tokens: 30 },
  { id: 'entry_64', kind: 'ai_reply', position: 64, tokens: 250 },
]

// Only entry_59 and entry_62 carry a world time.
const TIMES: ReadonlyMap<string, number> = new Map([
  ['entry_59', 3_600],
  ['entry_62', 7_200],
])

const EXCERPTS: Record<string, string> = {
  entry_59: 'I tie the mare outside the inn.',
  entry_60: 'The inn is warm and loud with drovers.',
  entry_61: 'I ask whether the ferry runs at night.',
  entry_62: 'She shrugs: the ferry runs when Tobin says it runs.',
  entry_63: 'I go down to the landing.',
  entry_64: 'The landing is a black line of planks over black water.',
}

const MODAL_INDEX = new Map<string, EntryRef>(
  SERIES.map((row) => [
    row.id,
    {
      id: row.id,
      position: row.position,
      kind: row.kind,
      chapterId: null,
      excerpt: EXCERPTS[row.id]!,
    },
  ]),
)

// Midnight, 1 January 2024: 3,600 s renders as 01:00 that day.
const ORIGIN_2024 = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

const TOOL_OFF: PipelineError = {
  kind: 'config-resolver',
  failure: 'tool-calling-off',
  target: 'lore-mgmt',
  phaseName: 'agent',
  modelId: 'gemma-4-26b',
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
    ...over,
  }
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

// A branch switch or reload republishes the open; it isn't a new open of the story.
function openStory(branchId = 'br_1'): void {
  currentStoryStore.set(story(branchId))
}

// Back to the story list and into the same story again.
function reopenStory(branchId = 'br_1'): void {
  currentStoryStore.open(story(branchId))
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

function pressOf(row: CloseReviewChange): () => void {
  const press = shown().pressOf(row)
  if (press == null) throw new Error(`${row.key} doesn't press`)
  return press
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

function holdResult(branchId: string, stoppedTasks = 0, chapterId = 'chap_2'): void {
  const openSeq = currentStoryStore.getOpenSeq()
  chapterOverlaysStore.showCloseResult({ branchId, openSeq, chapterId, stoppedTasks })
}

beforeEach(() => {
  resetAllStores()
  view.props = null
  view.renders = 0
  hostNavigate.mockReset()
  entryIndex.set(entryIndex.READY)
  entryIndex.retry.mockReset()
  reads.report.mockReset().mockResolvedValue(REPORT)
  reads.deltas.mockReset().mockResolvedValue(DELTAS)
  reads.kinds.mockReset().mockResolvedValue(new Map([['loc_mill', 'location']]))
  reads.build.mockReset().mockReturnValue(REVIEW)
  reads.series.mockReset().mockResolvedValue(SERIES)
  reads.times.mockReset().mockResolvedValue(TIMES)
  actions.start.mockReset()
  actions.raise.mockReset().mockResolvedValue('sys_1')
  modalView.props = null
  modalView.mounted = false
  modalView.frames = []
  openStory()
  chaptersStore.hydrate('br_1', [chapter()])
  entitiesStore.hydrate('br_1', [makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' })])
  loreStore.hydrate('br_1', [makeLore({ id: 'lore_tithe', title: 'The Tithe' })])
  threadsStore.hydrate('br_1', [
    { id: 'thr_relic', branchId: 'br_1', title: 'Recover the relic' } as Thread,
  ])
  happeningsStore.hydrate('br_1', [
    { id: 'hap_fire', branchId: 'br_1', title: 'The mill burns' } as Happening,
  ])
  happeningAwarenessStore.hydrate('br_1', [
    {
      id: 'haw_kael',
      branchId: 'br_1',
      characterId: 'char_kael',
      happeningId: 'hap_fire',
    } as HappeningAwareness,
  ])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChapterOverlaysHost — the review', () => {
  it('renders nothing while no window is open', () => {
    renderHost()
    expect(view.renders).toBe(0)
    expect(reads.report).not.toHaveBeenCalled()
  })

  it("reads the close's report, its deltas, and the deleted kinds of absent entities only", async () => {
    const props = await openReady()
    expect(props.open).toBe(true)
    expect(props.title).toBe('Review — Chapter 2: The Keep Leans Closer')
    expect(props.state).toEqual({ status: 'ready', review: REVIEW })
    expect(reads.report).toHaveBeenCalledWith({}, 'br_1', 'chap_2')
    expect(reads.deltas).toHaveBeenCalledWith({}, 'br_1', 'chap_2', 'act_close_2')
    expect(reads.kinds).toHaveBeenCalledWith({}, 'br_1', ['loc_mill'])
    expect(reads.build).toHaveBeenLastCalledWith(REPORT, DELTAS, expect.any(Object))
  })

  it('reads the deleted kinds beside the deltas, not after them', async () => {
    let release = () => {}
    reads.deltas.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(DELTAS)
        }),
    )
    renderHost()
    openWindow()
    await waitFor(() => expect(reads.kinds).toHaveBeenCalledWith({}, 'br_1', ['loc_mill']))
    expect(shown().state.status).toBe('loading')

    act(() => release())
    await waitFor(() => expect(view.props?.state.status).toBe('ready'))
  })

  it('logs a failed deleted-kinds read and shows failed', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    reads.kinds.mockRejectedValueOnce(new Error('kinds'))
    renderHost()
    openWindow()
    await waitFor(() => expect(view.props?.state.status).toBe('failed'))
    expect(error).toHaveBeenCalledWith('app.close_review_read_failed', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      error: 'kinds',
    })
  })

  it('builds the lookup from the stores, the deleted kinds and the entry index', async () => {
    await openReady()
    const lookup = reads.build.mock.lastCall?.[2] as CloseReviewLookup
    expect(lookup.entityKind('char_kael')).toBe('character')
    expect(lookup.entityKind('loc_mill')).toBe('location')
    expect(lookup.entityKind('char_nobody')).toBeUndefined()
    expect(lookup.nameOf('char_kael')).toBe('Kael')
    expect(lookup.nameOf('lore_tithe')).toBe('The Tithe')
    expect(lookup.nameOf('char_nobody')).toBeUndefined()
    expect(lookup.entryPosition('entry_47')).toBe(47)
    expect(lookup.entryPosition('entry_99')).toBeUndefined()
  })

  // A row deleted under the open window keeps its area: its kind was read when the window opened.
  it('keeps a kind read at open after the entity leaves the store', async () => {
    await openReady()
    act(() => entitiesStore.patch('br_1', { op: 'delete', id: 'char_kael' }))
    const lookup = reads.build.mock.lastCall?.[2] as CloseReviewLookup
    expect(lookup.entityKind('char_kael')).toBe('character')
  })

  it('re-reads after a settle and keeps the last review meanwhile', async () => {
    await openReady()
    const statuses: string[] = []
    const record = () => statuses.push(shown().state.status)
    settleRun()
    record()
    await waitFor(() => expect(reads.report).toHaveBeenCalledTimes(2))
    record()
    expect(statuses).toEqual(['ready', 'ready'])
  })

  it('logs a failed read, shows failed, and reads again on Retry', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    reads.report.mockRejectedValueOnce(new Error('disk'))
    renderHost()
    openWindow()
    await waitFor(() => expect(view.props?.state.status).toBe('failed'))
    expect(error).toHaveBeenCalledWith('app.close_review_read_failed', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      error: 'disk',
    })

    let release = () => {}
    reads.report.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(REPORT)
        }),
    )
    const state = shown().state
    if (state.status !== 'failed') throw new Error('expected the failed state')
    act(() => state.onRetry())
    await waitFor(() => expect(view.props?.state.status).toBe('loading'))

    act(() => release())
    await waitFor(() => expect(view.props?.state.status).toBe('ready'))
    expect(reads.report).toHaveBeenCalledTimes(2)
  })

  // Built before the index reads, the review would cite raw entry ids and offer no entry links.
  it('shows loading until the entry index has read, then the review with its entry links', async () => {
    entryIndex.set(entryIndex.PENDING)
    renderHost()
    openWindow()
    await waitFor(() => expect(reads.kinds).toHaveBeenCalled())
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(shown().state.status).toBe('loading')
    expect(reads.build).not.toHaveBeenCalled()

    act(() => entryIndex.set(entryIndex.READY))
    await waitFor(() => expect(view.props?.state.status).toBe('ready'))
    const lookup = reads.build.mock.lastCall?.[2] as CloseReviewLookup
    expect(lookup.entryPosition('entry_47')).toBe(47)
    expect(shown().entryLinkOf(KAEL)?.label).toBe('entry #47 →')
  })

  it("fails when the entry index's read failed, and Retry re-reads the index alone", async () => {
    entryIndex.set(entryIndex.FAILED)
    renderHost()
    openWindow()
    await waitFor(() => expect(reads.kinds).toHaveBeenCalled())
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(shown().state.status).toBe('failed')
    expect(reads.build).not.toHaveBeenCalled()

    const state = shown().state
    if (state.status !== 'failed') throw new Error('expected the failed state')
    act(() => state.onRetry())
    expect(entryIndex.retry).toHaveBeenCalledTimes(1)

    act(() => entryIndex.set(entryIndex.READY))
    await waitFor(() => expect(view.props?.state.status).toBe('ready'))
    expect(shown().entryLinkOf(KAEL)?.label).toBe('entry #47 →')
    expect(reads.report).toHaveBeenCalledTimes(1)
  })

  it('re-reads the index and the report on Retry when both failed', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    entryIndex.set(entryIndex.FAILED)
    reads.report.mockRejectedValueOnce(new Error('disk'))
    renderHost()
    openWindow()
    await waitFor(() => expect(reads.report).toHaveBeenCalledTimes(1))
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

    const state = shown().state
    if (state.status !== 'failed') throw new Error('expected the failed state')
    act(() => state.onRetry())
    expect(entryIndex.retry).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(reads.report).toHaveBeenCalledTimes(2))

    act(() => entryIndex.set(entryIndex.READY))
    await waitFor(() => expect(view.props?.state.status).toBe('ready'))
  })

  // Drizzle's JSON column parse throws a SyntaxError on corrupt text, not a ZodError.
  it('fails a corrupt report column the same way', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    reads.report.mockRejectedValueOnce(new SyntaxError('Unexpected token } in JSON'))
    renderHost()
    openWindow()
    await waitFor(() => expect(view.props?.state.status).toBe('failed'))
    expect(error).toHaveBeenCalledWith('app.close_review_read_failed', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      error: 'Unexpected token } in JSON',
    })
  })

  it('fails a report the column no longer holds', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    reads.report.mockResolvedValueOnce(null)
    renderHost()
    openWindow()
    await waitFor(() => expect(view.props?.state.status).toBe('failed'))
    expect(error).toHaveBeenCalledWith('app.close_review_read_failed', {
      branchId: 'br_1',
      chapterId: 'chap_2',
      error: 'close report missing',
    })
    expect(reads.deltas).not.toHaveBeenCalled()
  })

  it('closes on onOpenChange(false)', async () => {
    const props = await openReady()
    view.renders = 0
    act(() => props.onOpenChange(false))
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(view.renders).toBe(0)
  })
})

describe('ChapterOverlaysHost — presses', () => {
  it('closes the window before the guard runs, and a guard that holds navigates nothing', async () => {
    const seen: unknown[] = []
    const guard = vi.fn<(proceed: () => void) => void>(() => {
      seen.push(chapterOverlaysStore.getState().review)
    })
    const navigate = vi.fn<(path: string) => void>()
    chapterOverlaysStore.registerSurface({ guard, navigate })
    await openReady()

    act(() => pressOf(KAEL)())

    expect(guard).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([null])
    expect(navigate).not.toHaveBeenCalled()
    expect(hostNavigate).not.toHaveBeenCalled()
  })

  it("navigates through the surface's own navigate when its guard proceeds, as the reader's does", async () => {
    const navigate = vi.fn<(path: string) => void>()
    chapterOverlaysStore.registerSurface({ guard: (proceed) => proceed(), navigate })
    await openReady()

    act(() => pressOf(KAEL)())

    expect(navigate).toHaveBeenCalledExactlyOnceWith('/world/br_1?kind=character&id=char_kael')
    expect(hostNavigate).not.toHaveBeenCalled()
    expect(chapterOverlaysStore.getState().review).toBeNull()
  })

  it('pushes with its own navigate when no surface is registered', async () => {
    await openReady()
    act(() => pressOf(KAEL)())
    expect(hostNavigate).toHaveBeenCalledExactlyOnceWith('/world/br_1?kind=character&id=char_kael')
  })

  it("drops a second press made during the Sheet's exit", async () => {
    await openReady()
    const press = pressOf(KAEL)
    act(() => press())
    act(() => press())
    expect(hostNavigate).toHaveBeenCalledTimes(1)
  })

  it('links a cited entry the index holds, through the guard, and none it lacks', async () => {
    const navigate = vi.fn<(path: string) => void>()
    chapterOverlaysStore.registerSurface({ guard: (proceed) => proceed(), navigate })
    const props = await openReady()

    const link = props.entryLinkOf(KAEL)
    expect(link?.label).toBe('entry #47 →')
    act(() => link?.onPress())
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/reader-composer/br_1?entry=entry_47')
    expect(chapterOverlaysStore.getState().review).toBeNull()

    expect(props.entryLinkOf(MILL)).toBeUndefined()
  })

  it('gives no press to a target absent from its store, and drops one deleted under the window', async () => {
    await openReady()
    expect(shown().pressOf(MILL)).toBeUndefined()
    expect(shown().pressOf(KAEL)).toBeDefined()

    act(() => entitiesStore.patch('br_1', { op: 'delete', id: 'char_kael' }))
    expect(shown().pressOf(KAEL)).toBeUndefined()
  })

  it.each([
    ['lore', 'lore_tithe', '/world/br_1?kind=lore&id=lore_tithe', () => loreStore],
    ['threads', 'thr_relic', '/plot/br_1?kind=thread&id=thr_relic', () => threadsStore],
    ['happenings', 'hap_fire', '/plot/br_1?kind=happening&id=hap_fire', () => happeningsStore],
    [
      'happening_awareness',
      'haw_kael',
      '/plot/br_1?kind=happening&id=hap_fire&tab=awareness',
      () => happeningAwarenessStore,
    ],
  ] as const)(
    'presses a live %s row to its href, and drops it once the row leaves',
    async (table, id, href, rowStore) => {
      const row: CloseReviewChange = {
        ...KAEL,
        key: `0:${id}`,
        target: { table, id, name: id },
        pressTo: { table, id },
      }
      await openReady()

      act(() => pressOf(row)())
      expect(hostNavigate).toHaveBeenCalledExactlyOnceWith(href)

      openWindow()
      await waitFor(() => expect(view.props?.state.status).toBe('ready'))
      expect(shown().pressOf(row)).toBeDefined()
      act(() => rowStore().patch('br_1', { op: 'delete', id }))
      expect(shown().pressOf(row)).toBeUndefined()
    },
  )

  it('names threads and happenings from their stores', async () => {
    await openReady()
    const lookup = reads.build.mock.lastCall?.[2] as CloseReviewLookup
    expect(lookup.nameOf('thr_relic')).toBe('Recover the relic')
    expect(lookup.nameOf('hap_fire')).toBe('The mill burns')
  })
})

describe('ChapterOverlaysHost — the derived rule', () => {
  it('clears the id when the chapter leaves the store, and a redo reopens nothing', async () => {
    await openReady()
    act(() => chaptersStore.patch('br_1', { op: 'delete', id: 'chap_2' }))
    expect(chapterOverlaysStore.getState().review).toBeNull()

    view.renders = 0
    act(() => chaptersStore.patch('br_1', { op: 'create', id: 'chap_2', row: { ...chapter() } }))
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(view.renders).toBe(0)
  })

  it('clears the id when the chapter loses its report', async () => {
    await openReady()
    act(() =>
      chaptersStore.patch('br_1', { op: 'update', id: 'chap_2', columns: { closeReport: null } }),
    )
    expect(chapterOverlaysStore.getState().review).toBeNull()
  })

  it('renders nothing and keeps no id for a chapter not in the store', () => {
    renderHost()
    openWindow('chap_missing')
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(view.renders).toBe(0)
    expect(reads.report).not.toHaveBeenCalled()
  })

  it('closes the window when another branch opens', async () => {
    await openReady()
    act(() => openStory('br_2'))
    expect(chapterOverlaysStore.getState().review).toBeNull()
  })

  it("keeps the open branch's close result and clears another branch's", () => {
    renderHost()
    act(() => holdResult('br_1'))
    expect(chapterOverlaysStore.getState().closeResult).toEqual({
      branchId: 'br_1',
      openSeq: 0,
      chapterId: 'chap_2',
      stoppedTasks: 0,
    })

    act(() => holdResult('br_2'))
    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
  })

  it('clears a held close result when its chapter reverses', () => {
    renderHost()
    act(() => holdResult('br_1', 1))
    act(() => chaptersStore.patch('br_1', { op: 'delete', id: 'chap_2' }))
    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
  })

  it('clears a held close result when another branch opens', () => {
    renderHost()
    act(() => holdResult('br_1'))
    act(() => openStory('br_2'))
    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
  })

  it('clears a held close result when the story is left and opened again on the same branch', () => {
    act(() => reopenStory())
    renderHost()
    act(() => holdResult('br_1'))
    expect(chapterOverlaysStore.getState().closeResult).not.toBeNull()

    act(() => reopenStory())
    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
  })

  it("keeps a newer close's result in the same open", () => {
    renderHost()
    act(() => holdResult('br_1'))
    act(() =>
      chaptersStore.patch('br_1', {
        op: 'create',
        id: 'chap_3',
        row: chapter({ id: 'chap_3', sequenceNumber: 3 }),
      }),
    )
    act(() => holdResult('br_1', 1, 'chap_3'))
    expect(chapterOverlaysStore.getState().closeResult).toEqual({
      branchId: 'br_1',
      openSeq: 0,
      chapterId: 'chap_3',
      stoppedTasks: 1,
    })
  })
})

describe('ChapterOverlaysHost — the close modal', () => {
  beforeEach(() => {
    const open = story('br_1')
    currentStoryStore.set({
      ...open,
      definition: {
        ...open.definition,
        calendarSystemId: 'earth-gregorian',
        worldTimeOrigin: ORIGIN_2024,
      },
    })
    entryIndex.set({ ...entryIndex.READY, index: MODAL_INDEX })
  })

  const openModal = (request: { branchId: string; endEntryId?: string } = { branchId: 'br_1' }) =>
    act(() => chapterOverlaysStore.openCloseModal(request))

  // Both reads landed: the series gives the replies, the times the start row's label.
  async function shownModal(): Promise<CloseChapterModalViewProps> {
    await waitFor(() => expect(modalView.props?.replies).toHaveLength(3))
    await waitFor(() => expect(modalView.props?.start?.time).toBe('January 1, 2024 AD 01:00'))
    return modalView.props!
  }

  async function confirmLatest(): Promise<void> {
    renderHost()
    openModal()
    const props = await shownModal()
    act(() => props.onConfirm())
  }

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

  it('mounts no body, and reads nothing, while no request is held', () => {
    renderHost()
    expect(modalView.mounted).toBe(false)
    expect(reads.series).not.toHaveBeenCalled()
    expect(reads.times).not.toHaveBeenCalled()
  })

  it('shows the region from its first entry, its replies newest first, the latest picked', async () => {
    renderHost()
    openModal()
    const props = await shownModal()
    expect(props.open).toBe(true)
    expect(props.start).toEqual({
      id: 'entry_59',
      ref: 'entry #59',
      excerpt: EXCERPTS.entry_59,
      time: 'January 1, 2024 AD 01:00',
      endedChapterNumber: 2,
    })
    expect(props.replies).toEqual([
      { id: 'entry_64', ref: 'entry #64', excerpt: EXCERPTS.entry_64, time: null },
      {
        id: 'entry_62',
        ref: 'entry #62',
        excerpt: EXCERPTS.entry_62,
        time: 'January 1, 2024 AD 02:00',
      },
      { id: 'entry_60', ref: 'entry #60', excerpt: EXCERPTS.entry_60, time: null },
    ])
    expect(props.latestId).toBe('entry_64')
    expect(props.selectedId).toBe('entry_64')
    expect(props.tokensInRange).toBe(1000)
    expect(props.disabledReason).toBeUndefined()
    expect(reads.series).toHaveBeenCalledWith('br_1', { db: {} })
    expect(reads.times).toHaveBeenCalledWith('br_1', {})
  })

  it('opens on the end entry passed while it is one of the replies', async () => {
    renderHost()
    openModal({ branchId: 'br_1', endEntryId: 'entry_62' })
    const props = await shownModal()
    expect(props.selectedId).toBe('entry_62')
    expect(props.tokensInRange).toBe(720)
  })

  it('opens on the latest reply when the end passed is not one', async () => {
    renderHost()
    openModal({ branchId: 'br_1', endEntryId: 'entry_61' })
    expect((await shownModal()).selectedId).toBe('entry_64')
  })

  it('moves the selection and its count with a pick', async () => {
    renderHost()
    openModal()
    const props = await shownModal()
    act(() => props.onSelect('entry_60'))
    expect(modalView.props?.selectedId).toBe('entry_60')
    expect(modalView.props?.tokensInRange).toBe(420)
  })

  it('holds a pick over the end entry passed', async () => {
    renderHost()
    openModal({ branchId: 'br_1', endEntryId: 'entry_62' })
    const props = await shownModal()
    act(() => props.onSelect('entry_60'))
    expect(modalView.props?.selectedId).toBe('entry_60')
    expect(modalView.props?.tokensInRange).toBe(420)
  })

  // A close ending on entry_60 settled while the modal was up: the pick left the region.
  it('falls back to the latest reply once the pick is no longer one', async () => {
    renderHost()
    openModal()
    const props = await shownModal()
    act(() => props.onSelect('entry_60'))
    reads.series.mockResolvedValue(SERIES.slice(2))
    settleRun()
    await waitFor(() => expect(modalView.props?.replies).toHaveLength(2))
    expect(modalView.props?.selectedId).toBe('entry_64')
    expect(modalView.props?.tokensInRange).toBe(580)
  })

  it('tags no chapter on a branch with none closed', async () => {
    chaptersStore.hydrate('br_1', [])
    renderHost()
    openModal()
    expect((await shownModal()).start?.endedChapterNumber).toBeNull()
  })

  it("tags no chapter from another branch's rows still held", async () => {
    chaptersStore.hydrate('br_2', [chapter({ id: 'chap_9', branchId: 'br_2', sequenceNumber: 9 })])
    renderHost()
    openModal()
    expect((await shownModal()).start?.endedChapterNumber).toBeNull()
  })

  it("disables Close chapter with the gate's reason while a run holds it, and enables it after", async () => {
    renderHost()
    openModal()
    await shownModal()
    modalView.frames = []
    const run = gateRun()
    act(() => generationStore.startRun(run))
    await waitFor(() => expect(modalView.props?.disabledReason).toBe(t('generationGate.inFlight')))
    act(() => generationStore.finishRun(run.runId))
    await waitFor(() => expect(modalView.props?.disabledReason).toBeUndefined())
    // The settle re-reads both under a new key; the rows stay up meanwhile.
    await waitFor(() => expect(reads.series).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(reads.times).toHaveBeenCalledTimes(2))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(modalView.frames).not.toContainEqual(expect.objectContaining({ replies: 0 }))
    expect(modalView.frames).not.toContainEqual(expect.objectContaining({ startTime: null }))
  })

  // C15: a world-time edit moves neither settleCount nor the tail, and the client never goes stale.
  it('reads the world times again each time it opens', async () => {
    renderHost()
    openModal()
    await shownModal()
    act(() => modalView.props!.onCancel())
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(modalView.mounted).toBe(false)
    openModal()
    await waitFor(() => expect(reads.times).toHaveBeenCalledTimes(2))
    expect(reads.series).toHaveBeenCalledTimes(1)
  })

  it('logs a failed region read and offers nothing to confirm', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.series.mockRejectedValue(new Error('disk'))
    renderHost()
    openModal()
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('app.close_modal_read_failed', {
        branchId: 'br_1',
        read: 'series',
        error: 'disk',
      }),
    )
    expect(modalView.props).toMatchObject({
      start: null,
      replies: [],
      selectedId: null,
      tokensInRange: 0,
    })
    act(() => modalView.props!.onConfirm())
    expect(actions.start).not.toHaveBeenCalled()
  })

  // AC11's host half: the request belongs to the branch it was made on.
  it('clears the request when the open branch moves, and shows it on neither branch', async () => {
    renderHost()
    openModal()
    await shownModal()
    modalView.props = null
    act(() => openStory('br_2'))
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(modalView.mounted).toBe(false)
    act(() => openStory('br_1'))
    expect(modalView.mounted).toBe(false)
    // Not a frame of the request on br_2's open.
    expect(modalView.props).toBeNull()
  })

  it('drops a request for a branch the open story does not show', () => {
    renderHost()
    openModal({ branchId: 'br_2' })
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(modalView.mounted).toBe(false)
    // Never rendered, even for the frame before the drop.
    expect(modalView.props).toBeNull()
    expect(reads.series).not.toHaveBeenCalled()
  })

  it('shuts the modal at once on confirm, and starts the close on the selected end', async () => {
    // A close runs under the banner for minutes; the modal doesn't wait for it.
    actions.start.mockReturnValue(new Promise(() => {}))
    await confirmLatest()
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(modalView.mounted).toBe(false)
    expect(actions.start).toHaveBeenCalledWith('br_1', 'entry_64', {
      db: {},
      runInTransaction: expect.any(Function),
    })
  })

  // AC9's host half.
  it('writes the entry and toasts for a failed pre-flight', async () => {
    const warn = vi.spyOn(toast, 'warning').mockReturnValue('')
    actions.start.mockResolvedValue({ outcome: 'preflight-failed', error: TOOL_OFF })
    await confirmLatest()
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(t('chapters:closeModal.toast.preflightFailed')),
    )
    expect(actions.raise).toHaveBeenCalledWith(
      {
        branchId: 'br_1',
        content: expect.stringContaining('gemma-4-26b'),
        failure: expect.any(Function),
      },
      { db: {}, runInTransaction: expect.any(Function) },
    )
  })

  it('only toasts for a refused start', async () => {
    const warn = vi.spyOn(toast, 'warning').mockReturnValue('')
    actions.start.mockResolvedValue({ outcome: 'rejected', blockedBy: 'story-busy' })
    await confirmLatest()
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(t('reader:actions.blockedWhileGenerating')),
    )
    expect(actions.raise).not.toHaveBeenCalled()
  })

  it("does neither for a run's result", async () => {
    const warn = vi.spyOn(toast, 'warning').mockReturnValue('')
    actions.start.mockResolvedValue({ outcome: 'completed', runId: 'run_1', actionId: 'act_1' })
    await confirmLatest()
    await waitFor(() => expect(actions.start).toHaveBeenCalledOnce())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(warn).not.toHaveBeenCalled()
    expect(actions.raise).not.toHaveBeenCalled()
  })
})
