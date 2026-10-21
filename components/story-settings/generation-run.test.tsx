// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import { generationStore, type RunState, type TxState } from '@/lib/stores'

import {
  cancelStoryPillRun,
  generationGateReason,
  selectStorySettingsGenerationRunKind,
  storyPillPhase,
  storySettingsGenerationPhase,
  useStoryGenerationGate,
} from './generation-run'

type RunOptions = {
  storyId?: string
  branchId?: string
  gateBehavior?: RunState['gateBehavior']
  interruptible?: boolean
  beforeTurn?: boolean
}

function run(kind: string, options: RunOptions = {}): RunState {
  const storyId = options.storyId ?? 'story-1'
  const branchId = options.branchId ?? 'branch-1'
  return {
    runId: `run-${kind}-${storyId}-${branchId}`,
    kind,
    gateBehavior: options.gateBehavior ?? 'hard-gate',
    interruptible: options.interruptible ?? false,
    beforeTurn: options.beforeTurn ?? false,
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

// The periodic classifier as it declares itself: hard-gate and interruptible.
function pass(options: Pick<RunOptions, 'storyId' | 'branchId' | 'beforeTurn'> = {}): RunState {
  return run(PERIODIC_CLASSIFIER_KIND, { ...options, interruptible: true })
}

function tx(...runs: RunState[]): TxState {
  return {
    runs: new Map(runs.map((item) => [item.runId, item])),
    reversalInProgress: false,
    pendingTurns: new Set(),
    deferred: new Map(),
  }
}

type Gate = ReturnType<typeof useStoryGenerationGate>

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
  onResult: (gate: Gate) => void
}) {
  onResult(useStoryGenerationGate(storyId, branchId))
  return null
}

afterEach(() => {
  cleanup()
  generationStore.__reset()
})

describe('selectStorySettingsGenerationRunKind', () => {
  it('prefers a turn over a pass, a pass over another hard-gate run, and either over a refresh', () => {
    expect(selectStorySettingsGenerationRunKind(tx(pass(), run(PER_TURN_KIND)), 'story-1')).toBe(
      PER_TURN_KIND,
    )
    expect(
      selectStorySettingsGenerationRunKind(tx(run('translation-retry'), pass()), 'story-1'),
    ).toBe(PERIODIC_CLASSIFIER_KIND)
    expect(
      selectStorySettingsGenerationRunKind(
        tx(run(SUGGESTION_REFRESH_KIND), run('chapter-close')),
        'story-1',
      ),
    ).toBe('chapter-close')
  })

  // generation-pipeline.md → Pill currentPhase: the pass owns the pill over a refresh beside
  // it, so the pill's Cancel ends the pass, not the refresh.
  it('gives the pill to a pass over a refresh running beside it', () => {
    expect(
      selectStorySettingsGenerationRunKind(tx(run(SUGGESTION_REFRESH_KIND), pass()), 'story-1'),
    ).toBe(PERIODIC_CLASSIFIER_KIND)
    expect(selectStorySettingsGenerationRunKind(tx(run(SUGGESTION_REFRESH_KIND)), 'story-1')).toBe(
      SUGGESTION_REFRESH_KIND,
    )
  })

  it("covers every branch of the story and none of another story's", () => {
    expect(
      selectStorySettingsGenerationRunKind(tx(pass({ branchId: 'branch-2' })), 'story-1'),
    ).toBe(PERIODIC_CLASSIFIER_KIND)
    expect(
      selectStorySettingsGenerationRunKind(
        tx(run(PER_TURN_KIND, { storyId: 'story-2' })),
        'story-1',
      ),
    ).toBeNull()
  })

  // `useGeneration` compares with Object.is, so a selector that allocates its
  // result loops the subscriber until React trips the update-depth limit — and
  // only once a run is in flight, which is exactly when this route matters.
  it('subscribes without re-render churn while a run is in flight', () => {
    generationStore.startRun(pass())

    expect(() => render(<Probe />)).not.toThrow()
  })
})

describe('storySettingsGenerationPhase', () => {
  it('maps each pill-facing kind to its phase', () => {
    expect(storySettingsGenerationPhase(PERIODIC_CLASSIFIER_KIND)).toBe('updating-memory')
    expect(storySettingsGenerationPhase('chapter-close')).toBe('closing-chapter')
    expect(storySettingsGenerationPhase(SUGGESTION_REFRESH_KIND)).toBe('refreshing-suggestions')
    expect(storySettingsGenerationPhase(PER_TURN_KIND)).toBe('generating-narrative')
  })
})

describe('storyPillPhase', () => {
  it("is the pill run's phase, a pass included, and hides with no run", () => {
    expect(storyPillPhase(PERIODIC_CLASSIFIER_KIND)).toBe('updating-memory')
    expect(storyPillPhase('chapter-close')).toBe('closing-chapter')
    expect(storyPillPhase(null)).toBeUndefined()
  })
})

describe('useStoryGenerationGate', () => {
  // Pins the live subscription, not a selector re-evaluated by a fresh render.
  it("names the branch's pass, its before-turn flag and the memory reason, and clears when it ends", () => {
    const deferredPass = pass({ beforeTurn: true })
    generationStore.startRun(deferredPass)
    const captured: Gate[] = []
    render(
      <GateProbe storyId="story-1" branchId="branch-1" onResult={(gate) => captured.push(gate)} />,
    )
    expect(captured.at(-1)).toEqual({
      activeRunKind: PERIODIC_CLASSIFIER_KIND,
      editBlocked: true,
      gateReason: 'Updating memory. Cancel to edit.',
      beforeTurn: true,
    })

    act(() => {
      generationStore.finishRun(deferredPass.runId)
    })
    expect(captured.at(-1)).toEqual({
      activeRunKind: null,
      editBlocked: false,
      gateReason: undefined,
      beforeTurn: false,
    })
  })

  it('reads beforeTurn off the run, so a chained pass does not run before a turn', () => {
    generationStore.startRun(pass())
    let gate: Gate | undefined
    render(<GateProbe storyId="story-1" branchId="branch-1" onResult={(g) => (gate = g)} />)
    expect(gate?.activeRunKind).toBe(PERIODIC_CLASSIFIER_KIND)
    expect(gate?.beforeTurn).toBe(false)
  })

  it("picks among the branch's runs when given a branch, among the story's when not", () => {
    generationStore.startRun(pass({ branchId: 'branch-2' }))

    let byBranch: Gate | undefined
    render(<GateProbe storyId="story-1" branchId="branch-1" onResult={(g) => (byBranch = g)} />)
    expect(byBranch?.activeRunKind).toBeNull()

    let byStory: Gate | undefined
    render(<GateProbe storyId="story-1" onResult={(g) => (byStory = g)} />)
    expect(byStory?.activeRunKind).toBe(PERIODIC_CLASSIFIER_KIND)
  })
})

describe('generationGateReason', () => {
  it('is undefined while nothing blocks edits', () => {
    expect(generationGateReason(false, PERIODIC_CLASSIFIER_KIND)).toBeUndefined()
  })

  it('names a pass, a chapter close and a suggestion refresh, and any other run as generation in flight', () => {
    expect(generationGateReason(true, PERIODIC_CLASSIFIER_KIND)).toBe(
      'Updating memory. Cancel to edit.',
    )
    expect(generationGateReason(true, 'chapter-close')).toBe(
      'Chapter close in progress. Cancel to edit.',
    )
    expect(generationGateReason(true, SUGGESTION_REFRESH_KIND)).toBe(
      'Refreshing suggestions. Cancel to edit.',
    )
    expect(generationGateReason(true, PER_TURN_KIND)).toBe(
      'Generation is in flight. Cancel to edit.',
    )
    expect(generationGateReason(true, null)).toBe('Generation is in flight. Cancel to edit.')
  })
})

describe('cancelStoryPillRun', () => {
  it("aborts the pill's run on its own branch, not a sibling's run of another kind", () => {
    const refresh = run(SUGGESTION_REFRESH_KIND, { branchId: 'branch-1' })
    const turn = run(PER_TURN_KIND, { branchId: 'branch-2' })
    generationStore.startRun(refresh)
    generationStore.startRun(turn)

    cancelStoryPillRun('story-1')

    expect(turn.abortController.signal.aborted).toBe(true)
    expect(refresh.abortController.signal.aborted).toBe(false)
  })

  it("interrupts the story's pass and leaves another story's run alone", async () => {
    const mine = pass()
    const other = run(PER_TURN_KIND, { storyId: 'story-2', branchId: 'branch-9' })
    generationStore.startRun(other)
    generationStore.startRun(mine)

    cancelStoryPillRun('story-1')

    await vi.waitFor(() => expect(mine.abortController.signal.aborted).toBe(true))
    expect(other.abortController.signal.aborted).toBe(false)
  })

  // World and Plot pick their pill's run on their branch; Cancel must end that run, not the
  // story pill's pick (a turn on a sibling branch outranks the pass story-wide).
  it("with a branch, ends the run that branch's pill shows", async () => {
    const mine = pass({ branchId: 'branch-1' })
    const sibling = run(PER_TURN_KIND, { branchId: 'branch-2' })
    generationStore.startRun(sibling)
    generationStore.startRun(mine)

    cancelStoryPillRun('story-1', 'branch-1')

    await vi.waitFor(() => expect(mine.abortController.signal.aborted).toBe(true))
    expect(sibling.abortController.signal.aborted).toBe(false)
  })
})
