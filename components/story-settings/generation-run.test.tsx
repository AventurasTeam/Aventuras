// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { generationStore, type RunState, type TxState } from '@/lib/stores'

import {
  generationGateReason,
  selectStoryClassifierRunId,
  selectStorySettingsGenerationRunKind,
  storyPillPhase,
  storySettingsGenerationPhase,
  useStoryGenerationGate,
} from './generation-run'

function run(
  kind: string,
  storyId = 'story-1',
  gateBehavior: RunState['gateBehavior'] = 'hard-gate',
  branchId = 'branch-1',
): RunState {
  return {
    runId: `run-${kind}`,
    kind,
    gateBehavior,
    actionId: `action-${kind}`,
    storyId,
    branchId,
    abortController: new AbortController(),
    currentPhase: 'running',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

function tx(...runs: RunState[]): TxState {
  return { runs: new Map(runs.map((item) => [item.runId, item])), reversalInProgress: false }
}

function Probe() {
  generationStore.useGeneration((s) => selectStorySettingsGenerationRunKind(s.txState, 'story-1'))
  return null
}

function GateProbe({
  storyId,
  branchId,
  onResult,
}: {
  storyId: string
  branchId?: string
  onResult: (classifierRunId: string | null) => void
}) {
  const { classifierRunId } = useStoryGenerationGate(storyId, branchId)
  onResult(classifierRunId)
  return null
}

afterEach(() => {
  cleanup()
  generationStore.__reset()
})

describe('selectStorySettingsGenerationRunKind', () => {
  it('keeps the actual chapter-close kind for the universal cancel action', () => {
    expect(
      selectStorySettingsGenerationRunKind(
        tx(run('periodic-classifier', 'story-1', 'no-gate'), run('chapter-close')),
        'story-1',
      ),
    ).toBe('chapter-close')
  })

  it('prefers a narrative run over suggestion refresh and ignores another story', () => {
    expect(
      selectStorySettingsGenerationRunKind(
        tx(run('suggestion-refresh'), run('per-turn'), run('chapter-close', 'story-2')),
        'story-1',
      ),
    ).toBe('per-turn')
  })

  it('keeps a hard-gated suggestion refresh ahead of a no-gate classifier', () => {
    expect(
      selectStorySettingsGenerationRunKind(
        tx(run('periodic-classifier', 'story-1', 'no-gate'), run('suggestion-refresh')),
        'story-1',
      ),
    ).toBe('suggestion-refresh')
  })

  // `useGeneration` compares with Object.is, so a selector that allocates its
  // result loops the subscriber until React trips the update-depth limit — and
  // only once a run is in flight, which is exactly when this route matters.
  it('subscribes without re-render churn while a run is in flight', () => {
    generationStore.startRun(run('per-turn'))

    expect(() => render(<Probe />)).not.toThrow()
  })
})

describe('storySettingsGenerationPhase', () => {
  it('maps each pill-facing kind to its phase', () => {
    expect(storySettingsGenerationPhase('chapter-close')).toBe('closing-chapter')
    expect(storySettingsGenerationPhase('suggestion-refresh')).toBe('refreshing-suggestions')
    expect(storySettingsGenerationPhase('per-turn')).toBe('generating-narrative')
  })
})

describe('selectStoryClassifierRunId', () => {
  it("returns the story's classifier run id and nothing else", () => {
    expect(
      selectStoryClassifierRunId(tx(run('periodic-classifier', 'story-1', 'no-gate')), 'story-1'),
    ).toBe('run-periodic-classifier')
    expect(
      selectStoryClassifierRunId(tx(run('periodic-classifier', 'story-2', 'no-gate')), 'story-1'),
    ).toBeNull()
    expect(selectStoryClassifierRunId(tx(run('per-turn')), 'story-1')).toBeNull()
  })
})

describe('storyPillPhase', () => {
  it('shows a foreground run over the classifier pass', () => {
    expect(storyPillPhase('chapter-close', 'run-1')).toBe('closing-chapter')
  })

  it('shows the classifier pass as updating memory when nothing else runs', () => {
    expect(storyPillPhase(null, 'run-1')).toBe('updating-memory')
    expect(storyPillPhase(null, null)).toBeUndefined()
  })
})

describe('useStoryGenerationGate classifier run id', () => {
  it("yields the branch's classifier run id while it is in flight, then null once it finishes", () => {
    generationStore.startRun(run('periodic-classifier', 'story-1', 'no-gate', 'branch-1'))
    let captured: string | null = null
    const first = render(
      <GateProbe storyId="story-1" branchId="branch-1" onResult={(id) => (captured = id)} />,
    )
    expect(captured).toBe('run-periodic-classifier')
    first.unmount()

    generationStore.finishRun('run-periodic-classifier')
    render(<GateProbe storyId="story-1" branchId="branch-1" onResult={(id) => (captured = id)} />)
    expect(captured).toBeNull()
  })

  it('keys by branch when branchId is given, and by story when it is not', () => {
    generationStore.startRun(run('periodic-classifier', 'story-1', 'no-gate', 'branch-2'))

    let byBranch: string | null = null
    render(<GateProbe storyId="story-1" branchId="branch-1" onResult={(id) => (byBranch = id)} />)
    expect(byBranch).toBeNull()

    let byStory: string | null = null
    render(<GateProbe storyId="story-1" onResult={(id) => (byStory = id)} />)
    expect(byStory).toBe('run-periodic-classifier')
  })
})

describe('generationGateReason', () => {
  it('is undefined while nothing blocks edits', () => {
    expect(generationGateReason(false, 'chapter-close')).toBeUndefined()
  })

  it('names a chapter close, and any other blocking run as generation in flight', () => {
    expect(generationGateReason(true, 'chapter-close')).toBe(
      'Chapter close in progress. Cancel to edit.',
    )
    expect(generationGateReason(true, 'per-turn')).toBe('Generation is in flight. Cancel to edit.')
    expect(generationGateReason(true, null)).toBe('Generation is in flight. Cancel to edit.')
  })
})
