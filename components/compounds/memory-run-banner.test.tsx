// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema } from '@/lib/db'
import { CHAPTER_CLOSE_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import {
  chapterOverlaysStore,
  chaptersStore,
  currentStoryStore,
  generationStore,
  resetAllStores,
  type CloseProgress,
  type OpenStory,
  type RunState,
  type StoreChapter,
} from '@/lib/stores'

import {
  closeBannerLabel,
  useMemoryRunBanner,
  type MemoryRunBannerState,
} from './use-memory-run-banner'

function run(kind: string, over: Partial<RunState> = {}): RunState {
  return {
    runId: `run-${kind}`,
    kind,
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: `action-${kind}`,
    storyId: 'story-1',
    branchId: 'branch-1',
    abortController: new AbortController(),
    currentPhase: 'running',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
    ...over,
  }
}

function pass(over: Partial<RunState> = {}): RunState {
  return run(PERIODIC_CLASSIFIER_KIND, { interruptible: 'pass', ...over })
}

// An interruptible close of the open branch, before its first phase names itself.
function close(over: Partial<RunState> = {}): RunState {
  return run(CHAPTER_CLOSE_KIND, { interruptible: 'close', currentPhase: '', ...over })
}

function story(branchId: string): OpenStory {
  return {
    storyId: 'story-1',
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

function openStory(branchId = 'branch-1'): void {
  currentStoryStore.set(story(branchId))
}

// Back to the story list and into the same story again.
function reopenStory(branchId = 'branch-1'): void {
  currentStoryStore.open(story(branchId))
}

function runBanner(state: MemoryRunBannerState | null) {
  if (state?.kind !== 'run') throw new Error(`expected a run banner, got ${state?.kind ?? 'none'}`)
  return state
}

function closedBanner(state: MemoryRunBannerState | null) {
  if (state?.kind !== 'closed')
    throw new Error(`expected a done banner, got ${state?.kind ?? 'none'}`)
  return state
}

function chapter(over: Partial<StoreChapter> = {}): StoreChapter {
  return {
    id: 'chap_2',
    branchId: 'branch-1',
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

function holdResult(stoppedTasks = 0, branchId = 'branch-1', chapterId = 'chap_2'): void {
  const openSeq = currentStoryStore.getOpenSeq()
  chapterOverlaysStore.showCloseResult({ branchId, openSeq, chapterId, stoppedTasks })
}

afterEach(() => {
  cleanup()
  resetAllStores()
})

describe('useMemoryRunBanner', () => {
  it('shows nothing while no story is open, even with a pass in flight', () => {
    generationStore.startRun(pass())
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current).toBeNull()
  })

  it("labels the open branch's chained pass", () => {
    openStory()
    generationStore.startRun(pass())
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current?.label).toBe('Updating memory…')
    expect(result.current?.kind).toBe('run')
  })

  it('labels the pass Send runs before the turn', () => {
    openStory()
    generationStore.startRun(pass({ beforeTurn: true }))
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current?.label).toBe('Updating memory before your turn…')
  })

  it('follows the open story onto its branch', () => {
    openStory('branch-2')
    generationStore.startRun(pass({ branchId: 'branch-2' }))
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current?.label).toBe('Updating memory…')
  })

  it("shows nothing for another branch's pass or a run that isn't interruptible", () => {
    openStory()
    generationStore.startRun(pass({ runId: 'run-elsewhere', branchId: 'branch-2' }))
    generationStore.startRun(run(SUGGESTION_REFRESH_KIND))
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current).toBeNull()
  })

  it("labels the open branch's close", () => {
    openStory()
    generationStore.startRun(close())
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current?.label).toBe('Closing chapter…')
  })

  it('labels the close Send runs before the turn with its progress', () => {
    openStory()
    generationStore.startRun(
      close({
        beforeTurn: true,
        currentPhase: 'agent',
        closeProgress: { task: 'identity', part: 1, index: 3, total: 7 },
      }),
    )
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current?.label).toBe('Before your turn: 3 of 7 — Identity…')
  })

  it('shows nothing for an interruptible run of a kind with no banner', () => {
    openStory()
    generationStore.startRun(run('other-memory-run', { interruptible: 'pass' }))
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current).toBeNull()
  })

  it('interrupts the close on Cancel', async () => {
    openStory()
    const closing = close({ currentPhase: 'metadata' })
    generationStore.startRun(closing)
    const { result } = renderHook(() => useMemoryRunBanner())

    runBanner(result.current).onCancel()

    await vi.waitFor(() => expect(closing.abortController.signal.aborted).toBe(true))
  })

  // C6: a start-only event can't show the reset, so the last task's label stands until report.
  it("keeps the last task's label through the agent phase until report", () => {
    openStory()
    const closing = close({ currentPhase: 'agent' })
    generationStore.startRun(closing)
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current?.label).toBe('Closing chapter: reviewing the chapter…')

    act(() => {
      generationStore.setCloseProgress(closing.runId, {
        task: 'identity',
        part: 1,
        index: 3,
        total: 7,
      })
    })
    expect(result.current?.label).toBe('Closing chapter: 3 of 7 — Identity…')

    act(() => {
      generationStore.setCloseProgress(closing.runId, {
        task: 'awareness',
        part: 0,
        index: 7,
        total: 7,
      })
    })
    act(() => {
      generationStore.recordPhaseResult(closing.runId, 'agent', { status: 'completed' })
    })
    expect(result.current?.label).toBe('Closing chapter: 7 of 7 — Awareness…')

    act(() => {
      generationStore.setCurrentPhase(closing.runId, 'report')
    })
    expect(result.current?.label).toBe('Closing chapter: finishing up…')
  })

  it('interrupts the pass on Cancel and leaves a refresh beside it running', async () => {
    openStory()
    const memory = pass()
    const refresh = run(SUGGESTION_REFRESH_KIND)
    generationStore.startRun(refresh)
    generationStore.startRun(memory)
    const { result } = renderHook(() => useMemoryRunBanner())

    runBanner(result.current).onCancel()

    await vi.waitFor(() => expect(memory.abortController.signal.aborted).toBe(true))
    expect(refresh.abortController.signal.aborted).toBe(false)
  })

  it('goes away when the pass ends', () => {
    openStory()
    const memory = pass()
    generationStore.startRun(memory)
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current).not.toBeNull()

    act(() => {
      generationStore.finishRun(memory.runId)
    })
    expect(result.current).toBeNull()
  })
})

describe("useMemoryRunBanner — a committed close's done state", () => {
  it("shows the chapter's live title in the info tone", () => {
    openStory()
    chaptersStore.hydrate('branch-1', [chapter()])
    holdResult()
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(closedBanner(result.current)).toMatchObject({
      tone: 'info',
      label: 'Chapter closed: The Keep Leans Closer',
    })

    act(() => {
      chaptersStore.patch('branch-1', {
        op: 'update',
        id: 'chap_2',
        columns: { title: 'The Keep Holds' },
      })
    })
    expect(closedBanner(result.current).label).toBe('Chapter closed: The Keep Holds')
  })

  it('counts stopped tasks in the warning tone, singular and plural', () => {
    openStory()
    chaptersStore.hydrate('branch-1', [chapter()])
    holdResult(1)
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(closedBanner(result.current)).toMatchObject({
      tone: 'warning',
      label: 'Chapter closed, but 1 task stopped early',
    })

    act(() => holdResult(3))
    expect(closedBanner(result.current).label).toBe('Chapter closed, but 3 tasks stopped early')
  })

  it("a running close's label wins, and the done state returns once the run ends", () => {
    openStory()
    chaptersStore.hydrate('branch-1', [chapter()])
    holdResult()
    const closing = close()
    generationStore.startRun(closing)
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(runBanner(result.current).label).toBe('Closing chapter…')

    act(() => {
      generationStore.finishRun(closing.runId)
    })
    expect(closedBanner(result.current).label).toBe('Chapter closed: The Keep Leans Closer')
  })

  it('Review opens the window on the chapter and clears the result', () => {
    openStory()
    chaptersStore.hydrate('branch-1', [chapter()])
    holdResult()
    const { result } = renderHook(() => useMemoryRunBanner())

    act(() => closedBanner(result.current).onReview())

    expect(chapterOverlaysStore.getState().review).toEqual({ chapterId: 'chap_2' })
    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
    expect(result.current).toBeNull()
  })

  it('× clears the result and opens nothing', () => {
    openStory()
    chaptersStore.hydrate('branch-1', [chapter()])
    holdResult()
    const { result } = renderHook(() => useMemoryRunBanner())

    act(() => closedBanner(result.current).onDismiss())

    expect(chapterOverlaysStore.getState().closeResult).toBeNull()
    expect(chapterOverlaysStore.getState().review).toBeNull()
    expect(result.current).toBeNull()
  })

  it("shows nothing for another branch's result", () => {
    openStory()
    chaptersStore.hydrate('branch-1', [chapter()])
    holdResult(0, 'branch-2')
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current).toBeNull()
  })

  it('shows nothing once the story is left and opened again, though the branch is the same', () => {
    reopenStory()
    chaptersStore.hydrate('branch-1', [chapter()])
    holdResult()
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current?.kind).toBe('closed')

    act(() => reopenStory())
    expect(result.current).toBeNull()
  })

  it('shows nothing once the chapter leaves the store or loses its report', () => {
    openStory()
    chaptersStore.hydrate('branch-1', [chapter()])
    holdResult()
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current?.kind).toBe('closed')

    act(() => {
      chaptersStore.patch('branch-1', {
        op: 'update',
        id: 'chap_2',
        columns: { closeReport: null },
      })
    })
    expect(result.current).toBeNull()

    act(() => {
      chaptersStore.patch('branch-1', { op: 'delete', id: 'chap_2' })
    })
    expect(result.current).toBeNull()
  })
})

describe('useMemoryRunBanner — an older close result beside a newer close', () => {
  const OLD = 'Chapter closed: Old Chapter'

  function holdOld(): void {
    chaptersStore.hydrate('branch-1', [
      chapter({ id: 'chap_1', sequenceNumber: 1, title: 'Old Chapter' }),
    ])
    holdResult(0, 'branch-1', 'chap_1')
  }

  // The new close's row lands at its metadata phase, before the report that marks it closed.
  function createNewRow(): void {
    chaptersStore.patch('branch-1', {
      op: 'create',
      id: 'chap_2',
      row: chapter({
        id: 'chap_2',
        sequenceNumber: 2,
        title: 'New Chapter',
        hasCloseReport: false,
      }),
    })
  }

  const seen = (state: MemoryRunBannerState | null) =>
    state == null ? 'none' : `${state.kind}:${state.label}`

  it('never shows the older result while the newer close runs, nor in the gap before its own', () => {
    openStory()
    holdOld()
    const { result } = renderHook(() => useMemoryRunBanner())
    const labels = [seen(result.current)]
    const record = () => labels.push(seen(result.current))

    const closing = close({ currentPhase: 'metadata' })
    act(() => generationStore.startRun(closing))
    record()
    act(() => createNewRow())
    act(() => generationStore.setCurrentPhase(closing.runId, 'report'))
    record()
    act(() => {
      chaptersStore.patch('branch-1', {
        op: 'update',
        id: 'chap_2',
        columns: {
          closeReport: { version: 1, actionId: 'a', calls: [], stopped: [], noToolCalls: true },
        },
      })
    })
    act(() => generationStore.finishRun(closing.runId))
    record()
    act(() => holdResult(1))
    record()

    expect(labels).toEqual([
      `closed:${OLD}`,
      'run:Closing chapter: writing its summary…',
      'run:Closing chapter: finishing up…',
      'none',
      'closed:Chapter closed, but 1 task stopped early',
    ])
  })

  it('shows the result of the highest-numbered chapter whatever order the store holds them', () => {
    openStory()
    chaptersStore.hydrate('branch-1', [
      chapter({ id: 'chap_2', sequenceNumber: 2 }),
      chapter({ id: 'chap_1', sequenceNumber: 1, title: 'Old Chapter' }),
    ])
    holdResult()
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(closedBanner(result.current).label).toBe('Chapter closed: The Keep Leans Closer')
  })

  it('brings the older result back when the newer close is reversed', () => {
    openStory()
    holdOld()
    const { result } = renderHook(() => useMemoryRunBanner())
    act(() => createNewRow())
    expect(result.current).toBeNull()

    act(() => {
      chaptersStore.patch('branch-1', { op: 'delete', id: 'chap_2' })
    })
    expect(closedBanner(result.current).label).toBe(OLD)
  })

  it("shows nothing for a chapter held in the store under another branch's id", () => {
    openStory()
    chaptersStore.hydrate('branch-2', [chapter({ branchId: 'branch-2' })])
    holdResult(0, 'branch-1')
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current).toBeNull()
  })
})

describe('closeBannerLabel', () => {
  const IDENTITY: CloseProgress = { task: 'identity', part: 1, index: 3, total: 7 }

  it.each([
    ['boundary', 'Closing chapter: choosing where it ends…'],
    ['metadata', 'Closing chapter: writing its summary…'],
    ['agent', 'Closing chapter: reviewing the chapter…'],
    ['report', 'Closing chapter: finishing up…'],
    ['', 'Closing chapter…'],
  ])('labels phase %j', (currentPhase, label) => {
    expect(closeBannerLabel({ beforeTurn: false, currentPhase })).toBe(label)
  })

  it.each([
    ['happenings', 0, 1, 'Happenings'],
    ['lore', 1, 2, 'Lore'],
    ['identity', 1, 3, 'Identity'],
    ['threads', 1, 4, 'Threads'],
    ['upkeep', 1, 5, 'Upkeep'],
    ['lifecycle', 1, 6, 'Lifecycle'],
    ['awareness', 0, 7, 'Awareness'],
  ] as const)('counts task %s by its display name', (task, part, index, name) => {
    expect(
      closeBannerLabel({
        beforeTurn: false,
        currentPhase: 'agent',
        closeProgress: { task, part, index, total: 7 },
      }),
    ).toBe(`Closing chapter: ${index} of 7 — ${name}…`)
  })

  it.each([
    ['', undefined, 'Closing chapter before your turn…'],
    ['boundary', undefined, 'Before your turn: choosing where the chapter ends…'],
    ['metadata', undefined, "Before your turn: writing the chapter's summary…"],
    ['agent', undefined, 'Before your turn: reviewing the chapter…'],
    ['agent', IDENTITY, 'Before your turn: 3 of 7 — Identity…'],
    ['report', IDENTITY, 'Before your turn: finishing the chapter…'],
  ] as const)(
    'reads before your turn under Send in phase %j, with its progress',
    (currentPhase, closeProgress, label) => {
      expect(closeBannerLabel({ beforeTurn: true, currentPhase, closeProgress })).toBe(label)
    },
  )
})
