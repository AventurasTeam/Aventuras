// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CHAPTER_CLOSE_KIND, CHAPTER_CLOSE_RERUN } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import { generationStore, rerunHoldsReversal, type RunState, type TxState } from '@/lib/stores'

import {
  generationGateReason,
  headReversalGateReason,
  runGateKind,
  selectHeadReversalRunKind,
  selectRerunRunning,
  selectStorySettingsGenerationRunKind,
  storyPillPhase,
  storySettingsGenerationPhase,
  useStoryGenerationGate,
} from './generation-run'

type RunOptions = {
  storyId?: string
  branchId?: string
  gateBehavior?: RunState['gateBehavior']
  interruptible?: RunState['interruptible']
  beforeTurn?: boolean
}

function run(kind: string, options: RunOptions = {}): RunState {
  const storyId = options.storyId ?? 'story-1'
  const branchId = options.branchId ?? 'branch-1'
  return {
    runId: `run-${kind}-${storyId}-${branchId}`,
    kind,
    gateBehavior: options.gateBehavior ?? 'hard-gate',
    interruptible: options.interruptible ?? null,
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
  return run(PERIODIC_CLASSIFIER_KIND, { ...options, interruptible: 'pass' })
}

// A close reserved while pendingRerun holds its branch: chapter-close's runSlot gives it 'rerun'.
function rerun(options: Pick<RunOptions, 'storyId' | 'branchId'> = {}): RunState {
  return run(CHAPTER_CLOSE_KIND, { ...options, interruptible: 'rerun' })
}

function close(options: Pick<RunOptions, 'storyId' | 'branchId'> = {}): RunState {
  return run(CHAPTER_CLOSE_KIND, { ...options, interruptible: 'close' })
}

const RERUN_REASON = "Re-running the chapter's close. Cancel to edit."
const CLOSE_REASON = 'Chapter close in progress. Cancel to edit.'

function tx(...runs: RunState[]): TxState {
  return {
    runs: new Map(runs.map((item) => [item.runId, item])),
    reversalInProgress: false,
    pendingTurns: new Set(),
    deferred: new Map(),
    pendingClose: new Map(),
    pendingRerun: new Map(),
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

  // generation-pipeline.md → Pill currentPhase: the pill's Cancel ends the pass, not the refresh.
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
      cancelPillRun: expect.any(Function),
    })

    act(() => {
      generationStore.finishRun(deferredPass.runId)
    })
    expect(captured.at(-1)).toEqual({
      activeRunKind: null,
      editBlocked: false,
      gateReason: undefined,
      beforeTurn: false,
      cancelPillRun: expect.any(Function),
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
    generationStore.startRun(pass({ branchId: 'branch-2', beforeTurn: true }))

    let byBranch: Gate | undefined
    render(<GateProbe storyId="story-1" branchId="branch-1" onResult={(g) => (byBranch = g)} />)
    expect(byBranch?.activeRunKind).toBeNull()
    expect(byBranch?.beforeTurn).toBe(false)

    let byStory: Gate | undefined
    render(<GateProbe storyId="story-1" onResult={(g) => (byStory = g)} />)
    expect(byStory?.activeRunKind).toBe(PERIODIC_CLASSIFIER_KIND)
    expect(byStory?.beforeTurn).toBe(true)
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

describe('selectHeadReversalRunKind', () => {
  // principles.md → Disabled controls: beside a pass the refresh's cancel is the strip's ✕.
  it('names the refresh beside a pass, which the pill passes over for the pass', () => {
    const both = tx(pass(), run(SUGGESTION_REFRESH_KIND))
    expect(selectStorySettingsGenerationRunKind(both, 'story-1')).toBe(PERIODIC_CLASSIFIER_KIND)
    expect(generationGateReason(true, selectHeadReversalRunKind(both, 'branch-1'))).toBe(
      'Refreshing suggestions. Cancel to edit.',
    )
  })

  it("has no run while only this branch's pass holds the gate", () => {
    expect(selectHeadReversalRunKind(tx(pass()), 'branch-1')).toBeNull()
  })

  it("names another branch's pass, which a reversal here can't interrupt", () => {
    expect(selectHeadReversalRunKind(tx(pass({ branchId: 'branch-2' })), 'branch-1')).toBe(
      PERIODIC_CLASSIFIER_KIND,
    )
  })

  it('names a turn over a pass beside it', () => {
    expect(selectHeadReversalRunKind(tx(pass(), run(PER_TURN_KIND)), 'branch-1')).toBe(
      PER_TURN_KIND,
    )
  })

  it('ignores a run that holds no gate', () => {
    expect(
      selectHeadReversalRunKind(tx(run('translation-retry', { gateBehavior: 'no-gate' })), 'b'),
    ).toBeNull()
  })
})

describe('headReversalGateReason', () => {
  it('names the run a head reversal cannot interrupt over the pill', () => {
    expect(
      headReversalGateReason(true, {
        headReversal: SUGGESTION_REFRESH_KIND,
        pill: PERIODIC_CLASSIFIER_KIND,
      }),
    ).toBe('Refreshing suggestions. Cancel to edit.')
  })

  // A failure entry's Retry holds head reversals through its dispatch while its own pass, an
  // interruptible one, is the only run: the pill's Cancel is what ends it.
  it("falls back to the pill's run when no run holds the head reversals", () => {
    expect(
      headReversalGateReason(true, { headReversal: null, pill: PERIODIC_CLASSIFIER_KIND }),
    ).toBe('Updating memory. Cancel to edit.')
    expect(headReversalGateReason(true, { headReversal: null, pill: null })).toBe(
      'Generation is in flight. Cancel to edit.',
    )
  })

  it('is undefined while head reversals are open', () => {
    expect(
      headReversalGateReason(false, { headReversal: null, pill: PERIODIC_CLASSIFIER_KIND }),
    ).toBeUndefined()
  })
})

describe("useStoryGenerationGate's cancelPillRun", () => {
  function gateFor(storyId: string, branchId?: string): Gate {
    let gate: Gate | undefined
    render(<GateProbe storyId={storyId} branchId={branchId} onResult={(g) => (gate = g)} />)
    if (gate == null) throw new Error('gate not rendered')
    return gate
  }

  it("aborts the pill's run on its own branch, not a sibling's run of another kind", () => {
    const refresh = run(SUGGESTION_REFRESH_KIND, { branchId: 'branch-1' })
    const turn = run(PER_TURN_KIND, { branchId: 'branch-2' })
    generationStore.startRun(refresh)
    generationStore.startRun(turn)
    const gate = gateFor('story-1')
    expect(gate.activeRunKind).toBe(PER_TURN_KIND)

    gate.cancelPillRun()

    expect(turn.abortController.signal.aborted).toBe(true)
    expect(refresh.abortController.signal.aborted).toBe(false)
  })

  it("interrupts the story's pass and leaves another story's run alone", async () => {
    const mine = pass()
    const other = run(PER_TURN_KIND, { storyId: 'story-2', branchId: 'branch-9' })
    generationStore.startRun(other)
    generationStore.startRun(mine)
    const gate = gateFor('story-1')
    expect(gate.activeRunKind).toBe(PERIODIC_CLASSIFIER_KIND)

    gate.cancelPillRun()

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
    const gate = gateFor('story-1', 'branch-1')
    expect(gate.activeRunKind).toBe(PERIODIC_CLASSIFIER_KIND)

    gate.cancelPillRun()

    await vi.waitFor(() => expect(mine.abortController.signal.aborted).toBe(true))
    expect(sibling.abortController.signal.aborted).toBe(false)
  })

  it('follows the scope to a new branch, not the one it first rendered with', async () => {
    const left = run(PER_TURN_KIND, { branchId: 'branch-1' })
    const opened = pass({ branchId: 'branch-2' })
    generationStore.startRun(left)
    generationStore.startRun(opened)
    let gate: Gate | undefined
    const { rerender } = render(
      <GateProbe storyId="story-1" branchId="branch-1" onResult={(g) => (gate = g)} />,
    )
    rerender(<GateProbe storyId="story-1" branchId="branch-2" onResult={(g) => (gate = g)} />)
    expect(gate?.activeRunKind).toBe(PERIODIC_CLASSIFIER_KIND)

    gate?.cancelPillRun()

    await vi.waitFor(() => expect(opened.abortController.signal.aborted).toBe(true))
    expect(left.abortController.signal.aborted).toBe(false)
  })
})

describe('runGateKind', () => {
  it('names a re-run by its slot and any other run by its kind', () => {
    expect(runGateKind(rerun())).toBe(CHAPTER_CLOSE_RERUN)
    expect(runGateKind(close())).toBe(CHAPTER_CLOSE_KIND)
    expect(runGateKind(pass())).toBe(PERIODIC_CLASSIFIER_KIND)
    expect(runGateKind(run(PER_TURN_KIND))).toBe(PER_TURN_KIND)
  })
})

describe('a re-run at the gate', () => {
  it("names the re-run in the pill's kind and its reason, and a close as a close", () => {
    const kind = selectStorySettingsGenerationRunKind(tx(rerun()), 'story-1')
    expect(kind).toBe(CHAPTER_CLOSE_RERUN)
    expect(generationGateReason(true, kind)).toBe(RERUN_REASON)
    expect(
      generationGateReason(true, selectStorySettingsGenerationRunKind(tx(close()), 'story-1')),
    ).toBe(CLOSE_REASON)
  })

  // A re-run is interruptible on its own branch, so it blocks no head reversal there.
  it("blocks no head reversal on its own branch, and names itself to another branch's", () => {
    expect(selectHeadReversalRunKind(tx(rerun()), 'branch-1')).toBeNull()
    expect(selectHeadReversalRunKind(tx(rerun({ branchId: 'branch-2' })), 'branch-1')).toBe(
      CHAPTER_CLOSE_RERUN,
    )
  })

  // principles.md → Affordance loci: a re-run holding a reversal that reaches its chapter names the pill's run.
  it('names the re-run where no run blocks the head reversals', () => {
    expect(headReversalGateReason(true, { headReversal: null, pill: CHAPTER_CLOSE_RERUN })).toBe(
      RERUN_REASON,
    )
  })

  it('shows the pill as a chapter close', () => {
    expect(storySettingsGenerationPhase(CHAPTER_CLOSE_RERUN)).toBe('closing-chapter')
    expect(storyPillPhase(CHAPTER_CLOSE_RERUN)).toBe('closing-chapter')
  })

  it("gives the screens' gate the re-run's kind and reason while it runs", () => {
    generationStore.startRun(rerun())
    let gate: Gate | undefined
    render(<GateProbe storyId="story-1" branchId="branch-1" onResult={(g) => (gate = g)} />)
    expect(gate?.activeRunKind).toBe(CHAPTER_CLOSE_RERUN)
    expect(gate?.editBlocked).toBe(true)
    expect(gate?.gateReason).toBe(RERUN_REASON)
  })
})

describe('selectRerunRunning', () => {
  // The reader holds a row's ↻ and × when this holds and the row's entry is stamped; that must be
  // the answer rerunHoldsReversal gives for the row.
  it.each([
    ['rerun', 'chap_2', true],
    ['rerun', null, false],
    ['close', 'chap_2', false],
    ['pass', 'chap_2', false],
  ] as const)('under a %s run, a target in chapter %j is held: %s', (slot, chapterId, held) => {
    const state = tx(slot === 'pass' ? pass() : run(CHAPTER_CLOSE_KIND, { interruptible: slot }))
    expect(selectRerunRunning(state, 'branch-1') && chapterId != null).toBe(held)
    expect(rerunHoldsReversal(state, 'branch-1', { chapterId })).toBe(held)
  })

  it("reads false for another branch's re-run, and with no run", () => {
    expect(selectRerunRunning(tx(rerun({ branchId: 'branch-2' })), 'branch-1')).toBe(false)
    expect(selectRerunRunning(tx(), 'branch-1')).toBe(false)
  })
})
