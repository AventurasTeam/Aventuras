import { describe, expect, it } from 'vitest'

import type { RunState, TxState } from '@/lib/stores'

import { selectStorySettingsGenerationRun } from './generation-run'

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

describe('selectStorySettingsGenerationRun', () => {
  it('keeps the actual chapter-close kind for the universal cancel action', () => {
    expect(
      selectStorySettingsGenerationRun(
        tx(run('periodic-classifier', 'story-1', 'no-gate'), run('chapter-close')),
        'story-1',
      ),
    ).toMatchObject({
      kind: 'chapter-close',
      phase: 'closing-chapter',
    })
  })

  it('prefers a narrative run over suggestion refresh and ignores another story', () => {
    expect(
      selectStorySettingsGenerationRun(
        tx(run('suggestion-refresh'), run('per-turn'), run('chapter-close', 'story-2')),
        'story-1',
      ),
    ).toMatchObject({ kind: 'per-turn', phase: 'generating-narrative' })
  })

  it('keeps a hard-gated suggestion refresh ahead of a no-gate classifier', () => {
    expect(
      selectStorySettingsGenerationRun(
        tx(run('periodic-classifier', 'story-1', 'no-gate'), run('suggestion-refresh')),
        'story-1',
      ),
    ).toMatchObject({ kind: 'suggestion-refresh', phase: 'refreshing-suggestions' })
  })
})
