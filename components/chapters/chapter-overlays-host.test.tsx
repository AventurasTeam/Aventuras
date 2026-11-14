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
  type Thread,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { CloseReview, CloseReviewChange, CloseReviewLookup } from '@/lib/history'
import { makeEntity, makeLore } from '@/lib/list-modules/__tests__/fixtures'
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

import { ChapterOverlaysHost } from './chapter-overlays-host'
import type { ReviewWindowProps } from './review-window'

const reads = vi.hoisted(() => ({
  report: vi.fn(),
  deltas: vi.fn(),
  kinds: vi.fn(),
  build: vi.fn(),
}))

// The runtime `db` is a bridge client; the host only passes it to the mocked reads.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
}))

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
    index: new Map([
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
