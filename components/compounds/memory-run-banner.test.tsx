// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema } from '@/lib/db'
import { SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import { currentStoryStore, generationStore, resetAllStores, type RunState } from '@/lib/stores'

import { useMemoryRunBanner } from './use-memory-run-banner'

function run(kind: string, over: Partial<RunState> = {}): RunState {
  return {
    runId: `run-${kind}`,
    kind,
    gateBehavior: 'hard-gate',
    interruptible: false,
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
  return run(PERIODIC_CLASSIFIER_KIND, { interruptible: true, ...over })
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

  // A close's banner carries its own progress copy (principles.md → Affordance loci), so an
  // interruptible run of another kind never borrows the pass's label.
  it('shows nothing for an interruptible run of another kind', () => {
    openStory()
    generationStore.startRun(run('chapter-close', { interruptible: true }))
    const { result } = renderHook(() => useMemoryRunBanner())
    expect(result.current).toBeNull()
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
