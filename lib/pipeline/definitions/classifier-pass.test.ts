import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { idleStatus, PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, pipelineRuns, type ClassifierStatus } from '@/lib/db'
import { generationStore, type RunState } from '@/lib/stores'

import { runClassifierPass } from './classifier-pass'
import { CLASSIFIER_HELD } from './memory-chain'
import { makeHarness, resetSingletons } from '../__tests__/harness'
import { definePipeline } from '../authoring/define'
import type { PhaseContext, PhaseResult } from '../types'

type Db = Awaited<ReturnType<typeof makeHarness>>['db']

const IDS = { storyId: 's1', branchId: 'b1' }

// Each run of the pass: its actionId and whether it ran as Send's.
function defineRecordingPass(): { actionId: string; beforeTurn: boolean }[] {
  const runs: { actionId: string; beforeTurn: boolean }[] = []
  async function* classify(ctx: PhaseContext): AsyncGenerator<never, PhaseResult> {
    const run = [...generationStore.getTxState().runs.values()].find(
      (r) => r.actionId === ctx.actionId,
    )
    runs.push({ actionId: ctx.actionId, beforeTurn: run?.beforeTurn ?? false })
    return { status: 'completed' }
  }
  definePipeline({
    kind: PERIODIC_CLASSIFIER_KIND,
    phases: [{ name: 'classify', run: classify }],
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
    interruptible: 'pass',
    concurrencyPolicy: { blockedBy: [PERIODIC_CLASSIFIER_KIND] },
  })
  return runs
}

function livePass(): RunState {
  return {
    runId: 'run_pass',
    kind: PERIODIC_CLASSIFIER_KIND,
    gateBehavior: 'hard-gate',
    interruptible: 'pass',
    beforeTurn: false,
    actionId: 'act_pass',
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: 'classify',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

async function setState(db: Db, state: ClassifierStatus['state']): Promise<void> {
  await db
    .update(branches)
    .set({ classifierStatus: { ...idleStatus(), state } })
    .where(eq(branches.id, 'b1'))
}

describe('runClassifierPass', () => {
  beforeEach(() => {
    resetSingletons()
  })

  // classifier.md → Failure policy: a pass over a held branch would re-read writes still on disk.
  it('refuses a branch held running, starting no run', async () => {
    const { db, ctx } = await makeHarness()
    const runs = defineRecordingPass()
    await setState(db, 'running')

    const result = await runClassifierPass(IDS, ctx)

    expect(result).toEqual({ outcome: 'rejected', blockedBy: CLASSIFIER_HELD })
    expect(runs).toEqual([])
    expect(await db.select().from(pipelineRuns)).toEqual([])
  })

  it.each(['idle', 'failed'] as const)('runs a pass on a %s branch', async (state) => {
    const { db, ctx } = await makeHarness()
    const runs = defineRecordingPass()
    await setState(db, state)

    const result = await runClassifierPass(IDS, ctx)

    expect(result).toMatchObject({ outcome: 'completed' })
    expect(runs).toEqual([{ actionId: expect.any(String), beforeTurn: false }])
    expect(await db.select({ kind: pipelineRuns.kind }).from(pipelineRuns)).toEqual([
      { kind: PERIODIC_CLASSIFIER_KIND },
    ])
  })

  it('marks the run as Send’s only when asked', async () => {
    const { ctx } = await makeHarness()
    const runs = defineRecordingPass()

    await runClassifierPass(IDS, ctx, { beforeTurn: true })

    expect(runs).toEqual([{ actionId: expect.any(String), beforeTurn: true }])
  })

  it('hands a running branch whose pass is live to the orchestrator, whose own rule refuses it', async () => {
    const { db, ctx } = await makeHarness()
    const runs = defineRecordingPass()
    await setState(db, 'running')
    generationStore.startRun(livePass())

    const result = await runClassifierPass(IDS, ctx)

    expect(result).toEqual({ outcome: 'rejected', blockedBy: PERIODIC_CLASSIFIER_KIND })
    expect(runs).toEqual([])
  })

  it('registers the pass pipeline before starting it', async () => {
    const { db, ctx } = await makeHarness()

    const result = await runClassifierPass(IDS, ctx)

    expect(result.outcome).not.toBe('rejected')
    expect(await db.select({ kind: pipelineRuns.kind }).from(pipelineRuns)).toEqual([
      { kind: PERIODIC_CLASSIFIER_KIND },
    ])
  })
})
