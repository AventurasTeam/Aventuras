import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type PipelineAction } from '@/lib/actions'
import { deltas, pipelineRuns, storyEntries } from '@/lib/db'
import { getDiagnosticsSnapshot } from '@/lib/diagnostics'
import {
  definePipeline,
  pipelineEventBus,
  runPipeline,
  type PhaseContext,
  type PhaseResult,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import { expectRan, makeHarness, resetSingletons } from './harness'

const base = { affordance: 'invisible', gateBehavior: 'hard-gate', concurrencyPolicy: {} } as const

// Synthetic phase: warn (recoverable) -> create entry -> complete.
async function* phase(): AsyncGenerator<
  | { type: 'recoverable_error'; error: { kind: 'phase-logic'; detail: string } }
  | { type: 'delta_emitted'; action: PipelineAction },
  PhaseResult
> {
  yield { type: 'recoverable_error', error: { kind: 'phase-logic', detail: 'synthetic hiccup' } }
  yield {
    type: 'delta_emitted',
    action: {
      kind: 'createStoryEntry',
      source: 'ai_classifier',
      payload: {
        entry: {
          id: 'entry_1',
          branchId: 'b1',
          position: 1,
          kind: 'ai_reply',
          content: 'hi',
          createdAt: 1,
        },
      },
    },
  }
  return { status: 'completed' }
}

describe('orchestrator happy path', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  it('runs begin -> delta -> commit and updates every surface', async () => {
    const { db, ctx } = await makeHarness()
    definePipeline({ kind: 'synthetic', phases: [{ name: 'only', run: phase }], ...base })

    let sizeDuringRun = -1
    const off = pipelineEventBus.subscribe('run_start', () => {
      sizeDuringRun = generationStore.getTxState().runs.size
    })
    const result = expectRan(await runPipeline('synthetic', ctx))
    off()

    expect(result.outcome).toBe('completed')
    expect(sizeDuringRun).toBe(1) // run present during execution
    expect(generationStore.getTxState().runs.size).toBe(0) // cleared after

    const [pr] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, result.runId))
    expect(pr.outcome).toBe('completed')
    expect(pr.finishedAt).not.toBeNull()

    expect((await db.select().from(deltas)).length).toBe(1)
    expect(
      (await db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_1'))).length,
    ).toBe(1)

    const snap = getDiagnosticsSnapshot()
    const turn = snap.turnCaptures.find((t) => t.actionId === result.actionId)
    expect(turn?.outcome).toBe('completed')
    expect(turn?.endedAt).toBeDefined()
    expect(snap.logEntries.some((e) => e.kind === 'pipeline.run_complete')).toBe(true)
  })

  it('threads the ambient actionId through logger.warn, cleared after commit', async () => {
    const { ctx } = await makeHarness()
    definePipeline({ kind: 'synthetic', phases: [{ name: 'only', run: phase }], ...base })
    const result = expectRan(await runPipeline('synthetic', ctx))

    const warn = getDiagnosticsSnapshot().logEntries.find(
      (e) => e.kind === 'pipeline.recoverable_error',
    )
    expect(warn?.actionId).toBe(result.actionId)
  })

  it('a phase logs via ctx.log, attributed to its run', async () => {
    const { ctx } = await makeHarness()
    async function* logPhase(c: PhaseContext): AsyncGenerator<never, PhaseResult> {
      c.log.debug('pipeline.phase_log', { marker: 'from-phase' })
      return { status: 'completed' }
    }
    definePipeline({ kind: 'logs', phases: [{ name: 'p', run: logPhase }], ...base })
    const result = expectRan(await runPipeline('logs', ctx))

    const entry = getDiagnosticsSnapshot().logEntries.find((e) => e.fields.marker === 'from-phase')
    expect(entry).toBeDefined()
    expect(entry?.actionId).toBe(result.actionId)
  })
})

// classifier.md → Failure policy: a pass's run_complete tells Send's own pass from a chained one.
describe('run_complete names beforeTurn', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  type Complete = { kind: string; outcome: string; beforeTurn: boolean }

  function recordCompletes(): Complete[] {
    const seen: Complete[] = []
    pipelineEventBus.subscribe('run_complete', (e) => {
      seen.push({ kind: e.kind, outcome: e.outcome, beforeTurn: e.beforeTurn })
    })
    return seen
  }

  it.each([
    ['completed', { status: 'completed' }],
    ['failed', { status: 'failed', error: { kind: 'phase-logic', detail: 'boom' } }],
    ['aborted', { status: 'aborted' }],
  ] as const)("carries the run's beforeTurn when the run ends %s", async (outcome, end) => {
    const { ctx } = await makeHarness()
    async function* ends(): AsyncGenerator<never, PhaseResult> {
      return end
    }
    definePipeline({ kind: 'send-work', phases: [{ name: 'p', run: ends }], ...base })
    const seen = recordCompletes()

    expect(expectRan(await runPipeline('send-work', { ...ctx, beforeTurn: true })).outcome).toBe(
      outcome,
    )
    expect(expectRan(await runPipeline('send-work', ctx)).outcome).toBe(outcome)

    expect(seen).toEqual([
      { kind: 'send-work', outcome, beforeTurn: true },
      { kind: 'send-work', outcome, beforeTurn: false },
    ])
  })
})
