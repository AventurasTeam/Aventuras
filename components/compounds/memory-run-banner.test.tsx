// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema } from '@/lib/db'
import { CHAPTER_CLOSE_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import {
  currentStoryStore,
  generationStore,
  resetAllStores,
  type CloseProgress,
  type RunState,
} from '@/lib/stores'

import { closeBannerLabel, useMemoryRunBanner } from './use-memory-run-banner'

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

function openStory(branchId = 'branch-1'): void {
  currentStoryStore.set({
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
  })
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

    result.current?.onCancel()

    await vi.waitFor(() => expect(closing.abortController.signal.aborted).toBe(true))
  })

  // A start-only event can't show the reset, so the last task's label stands until report.
  it("keeps the last task's label through the agent phase until report", () => {
    openStory()
    const closing = close({ currentPhase: 'agent' })
    generationStore.startRun(closing)
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current?.label).toBe('Closing chapter: reviewing the chapter…')

    act(() => {
      generationStore.setCloseProgress(closing.runId, {
        task: 'identity',
        part: 0,
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

    result.current?.onCancel()

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

describe('closeBannerLabel', () => {
  const IDENTITY: CloseProgress = { task: 'identity', part: 0, index: 3, total: 7 }

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
    ['happenings', 1, 'Happenings'],
    ['lore', 2, 'Lore'],
    ['identity', 3, 'Identity'],
    ['threads', 4, 'Threads'],
    ['upkeep', 5, 'Upkeep'],
    ['lifecycle', 6, 'Lifecycle'],
    ['awareness', 7, 'Awareness'],
  ] as const)('counts task %s by its display name', (task, index, name) => {
    expect(
      closeBannerLabel({
        beforeTurn: false,
        currentPhase: 'agent',
        closeProgress: { task, part: 0, index, total: 7 },
      }),
    ).toBe(`Closing chapter: ${index} of 7 — ${name}…`)
  })

  it.each([
    ['', undefined],
    ['boundary', undefined],
    ['agent', IDENTITY],
    ['report', IDENTITY],
  ] as const)('reads before your turn under Send in phase %j', (currentPhase, closeProgress) => {
    expect(closeBannerLabel({ beforeTurn: true, currentPhase, closeProgress })).toBe(
      'Closing chapter before your turn…',
    )
  })
})
