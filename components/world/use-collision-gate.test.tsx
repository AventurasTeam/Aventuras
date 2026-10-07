// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { generationStore, type RunState } from '@/lib/stores'

import { useCollisionGate } from './use-collision-gate'

const STORY = 'story-1'
const BRANCH = 'branch-1'

function run(kind: string, gateBehavior: RunState['gateBehavior']): RunState {
  return {
    runId: `run-${kind}`,
    kind,
    gateBehavior,
    actionId: `action-${kind}`,
    storyId: STORY,
    branchId: BRANCH,
    abortController: new AbortController(),
    currentPhase: 'running',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

afterEach(() => {
  cleanup()
  generationStore.__reset()
})

describe('useCollisionGate', () => {
  it('leaves Resolve open while no run blocks edits', () => {
    const { result } = renderHook(() => useCollisionGate(STORY, BRANCH))
    expect(result.current).toBeUndefined()
  })

  it("blocks Resolve with the gate's reason once a hard-gate run starts, and reopens after", () => {
    const { result } = renderHook(() => useCollisionGate(STORY, BRANCH))

    act(() => generationStore.startRun(run('chapter-close', 'hard-gate')))
    expect(result.current).toBe('Chapter close in progress. Cancel to edit.')

    act(() => generationStore.finishRun('run-chapter-close'))
    expect(result.current).toBeUndefined()
  })

  it('names a narrative turn as generation in flight', () => {
    const { result } = renderHook(() => useCollisionGate(STORY, BRANCH))
    act(() => generationStore.startRun(run('per-turn', 'hard-gate')))
    expect(result.current).toBe('Generation is in flight. Cancel to edit.')
  })

  it('leaves Resolve open during a no-gate classifier pass', () => {
    const { result } = renderHook(() => useCollisionGate(STORY, BRANCH))
    act(() => generationStore.startRun(run('periodic-classifier', 'no-gate')))
    expect(result.current).toBeUndefined()
  })
})
