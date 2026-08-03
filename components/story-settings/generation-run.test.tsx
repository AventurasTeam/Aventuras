// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { generationStore, type RunState, type TxState } from '@/lib/stores'

import {
  selectStorySettingsGenerationRunKind,
  storySettingsGenerationPhase,
} from './generation-run'

function run(
  kind: string,
  storyId = 'story-1',
  gateBehavior: RunState['gateBehavior'] = 'hard-gate',
): RunState {
  return {
    runId: `run-${kind}`,
    kind,
    gateBehavior,
    actionId: `action-${kind}`,
    storyId,
    branchId: 'branch-1',
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
