import { beforeEach, describe, expect, it } from 'vitest'

import {
  awaitRunTerminal,
  backgroundClassifierRunning,
  generationStore,
  isForegroundGenerating,
  isUserEditBlocked,
  type RunState,
  type TxState,
} from './generation'

function run(id: string, kind = 'synthetic'): RunState {
  return {
    runId: id,
    kind,
    gateBehavior: 'no-gate',
    actionId: `act_${id}`,
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

describe('isUserEditBlocked', () => {
  it('blocks only when a hard-gate run is in flight', () => {
    const mk = (kind: string, gate: 'hard-gate' | 'no-gate') => ({
      ...run(kind),
      gateBehavior: gate,
    })
    const tx = (runs: ReturnType<typeof mk>[], reversalInProgress = false): TxState => ({
      runs: new Map(runs.map((r) => [r.runId, r])),
      reversalInProgress,
    })
    expect(isUserEditBlocked(tx([]))).toBe(false)
    expect(isUserEditBlocked(tx([mk('bg', 'no-gate')]))).toBe(false)
    expect(isUserEditBlocked(tx([mk('bg', 'no-gate'), mk('fg', 'hard-gate')]))).toBe(true)
    expect(isUserEditBlocked(tx([], true))).toBe(true)
  })
})

describe('generation store', () => {
  beforeEach(() => generationStore.__reset())

  it('startRun adds, abortRun removes', () => {
    generationStore.startRun(run('run_1'))
    expect(generationStore.getTxState().runs.has('run_1')).toBe(true)
    generationStore.abortRun('run_1')
    expect(generationStore.getTxState().runs.has('run_1')).toBe(false)
  })

  it('finishRun(predecessor, successor) is atomic — no empty intermediate state', () => {
    generationStore.startRun(run('run_pred', 'per-turn'))
    generationStore.finishRun('run_pred', run('run_succ', 'chapter-close'))
    const runs = generationStore.getTxState().runs // synchronous read immediately after
    expect(runs.has('run_pred')).toBe(false)
    expect(runs.has('run_succ')).toBe(true)
    expect(runs.size).toBe(1)
  })
})

describe('isForegroundGenerating', () => {
  beforeEach(() => generationStore.__reset())

  function runFor(kind: string, branchId = 'branch_1'): RunState {
    return { ...run(`run_${kind}`, kind), branchId }
  }

  it('is false for a periodic-classifier run', () => {
    generationStore.startRun(runFor('periodic-classifier'))
    const tx = generationStore.getTxState()
    expect(isForegroundGenerating(tx, 'branch_1')).toBe(false)
    expect(backgroundClassifierRunning(tx, 'branch_1')).toBe(true)
  })

  it('is true for a per-turn run on the same branch', () => {
    generationStore.startRun(runFor('per-turn'))
    expect(isForegroundGenerating(generationStore.getTxState(), 'branch_1')).toBe(true)
  })

  it('ignores runs on other branches', () => {
    generationStore.startRun(runFor('per-turn', 'branch_other'))
    expect(isForegroundGenerating(generationStore.getTxState(), 'branch_1')).toBe(false)
  })

  // Denylist, not allowlist: a kind added later must default to foreground, so a
  // new pipeline shows the pill rather than running invisibly.
  it('treats an unknown kind as foreground', () => {
    generationStore.startRun(runFor('some-future-pipeline'))
    expect(isForegroundGenerating(generationStore.getTxState(), 'branch_1')).toBe(true)
  })
})

describe('awaitRunTerminal', () => {
  function runFor(kind: string) {
    let resolveTerminal!: () => void
    const terminal = new Promise<void>((r) => {
      resolveTerminal = r
    })
    return {
      runId: `run_${kind}`,
      kind,
      gateBehavior: 'no-gate' as const,
      actionId: 'act_1',
      storyId: 'story_1',
      branchId: 'branch_1',
      abortController: new AbortController(),
      currentPhase: '',
      intermediates: {},
      terminal,
      resolveTerminal,
    }
  }

  it('resolves immediately when no run of the kind is in flight', async () => {
    await expect(awaitRunTerminal('periodic-classifier', 'cancel')).resolves.toBeUndefined()
  })

  it('aborts then awaits the terminal on cancel', async () => {
    const run = runFor('periodic-classifier')
    generationStore.startRun(run)
    const waited = awaitRunTerminal('periodic-classifier', 'cancel')
    expect(run.abortController.signal.aborted).toBe(true)
    run.resolveTerminal()
    await expect(waited).resolves.toBeUndefined()
  })

  it('does not abort on finish', async () => {
    const run = runFor('periodic-classifier')
    generationStore.startRun(run)
    const waited = awaitRunTerminal('periodic-classifier', 'finish')
    expect(run.abortController.signal.aborted).toBe(false)
    run.resolveTerminal()
    await waited
  })
})
