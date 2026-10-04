import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyDeltaAction,
  DeltaReplayError,
  describeDeltaReplayError,
  registerAllDomains,
  reverseReplayDeltas,
  settleUserWrites,
  type DbCtx,
  type DeltaSource,
  type MutationResult,
  type PipelineAction,
} from '@/lib/actions'
import {
  __resetBranchWriteLocks,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '@/lib/actions/delta/branch-write-lock'
import { deltas, happenings } from '@/lib/db'
import {
  configureDeltaActionPort,
  definePipeline,
  runPipeline,
  type DeltaActionPort,
  type PhaseEmittedEvent,
  type PhaseFn,
  type PhaseResult,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import { expectRan, makeHarness, resetSingletons } from './harness'

type Gate = { opened: Promise<void>; open: () => void }

function gate(): Gate {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still pending after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function happening(id: string, source: DeltaSource, branchId = 'b1'): PipelineAction {
  return {
    kind: 'createHappening',
    source,
    payload: { entry: { id, branchId, title: id, createdAt: 1, updatedAt: 1 } },
  }
}

// A Save from outside the run; `settled` reads its state without awaiting it.
function userWrite(
  ctx: DbCtx,
  id: string,
): { write: Promise<MutationResult>; settled: () => boolean } {
  let settled = false
  const write = applyDeltaAction(
    { action: happening(id, 'user_edit'), actionId: 'act_user', branchId: 'b1' },
    ctx,
  )
  write.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  return { write, settled: () => settled }
}

async function committedAt(write: Promise<MutationResult>): Promise<number> {
  const result = await within(write, 2000)
  if (result.status !== 'ok' || result.logPosition == null)
    throw new Error(`write did not commit: ${JSON.stringify(result)}`)
  return result.logPosition
}

async function positionsOf(ctx: DbCtx, actionId: string): Promise<number[]> {
  const rows = await ctx.db
    .select({ lp: deltas.logPosition })
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
  return rows.map((row) => row.lp)
}

async function happeningIds(ctx: DbCtx): Promise<string[]> {
  const rows = await ctx.db.select({ id: happenings.id }).from(happenings)
  return rows.map((row) => row.id).sort()
}

function configurePort(overrides: Partial<DeltaActionPort>): void {
  configureDeltaActionPort({
    applyDeltaAction,
    reverseReplayDeltas,
    describeReplayError: describeDeltaReplayError,
    settleUserWrites,
    holdWritePhase: holdBranchWriteExclusive,
    releaseWritePhase: releaseBranchWriteExclusive,
    ...overrides,
  })
}

// Records which actions the orchestrator asks to hold or release, then forwards to the real lock.
function spyOnLock(): { holds: string[]; releases: string[] } {
  const holds: string[] = []
  const releases: string[] = []
  configurePort({
    holdWritePhase: (branchId, actionId) => {
      holds.push(actionId)
      return holdBranchWriteExclusive(branchId, actionId)
    },
    releaseWritePhase: (branchId, actionId) => {
      releases.push(actionId)
      releaseBranchWriteExclusive(branchId, actionId)
    },
  })
  return { holds, releases }
}

// Parks before its first write (the model call) and again between its two writes.
function defineBurst(
  gateBehavior: 'no-gate' | 'hard-gate',
  second: PipelineAction = happening('hap_run_2', 'periodic_classifier'),
) {
  const started = gate()
  const modelCall = gate()
  const firstLanded = gate()
  const midBurst = gate()
  async function* burst(): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
    started.open()
    await modelCall.opened
    yield { type: 'delta_emitted', action: happening('hap_run_1', 'periodic_classifier') }
    firstLanded.open()
    await midBurst.opened
    yield { type: 'delta_emitted', action: second }
    return { status: 'completed' }
  }
  definePipeline({
    kind: 'burst',
    phases: [{ name: 'burst', run: burst }],
    affordance: 'invisible',
    gateBehavior,
    concurrencyPolicy: {},
  })
  return { started, modelCall, firstLanded, midBurst }
}

// The happening handler refuses an entry on another branch, so this write fails the run.
const REFUSED = happening('hap_run_2', 'periodic_classifier', 'b_other')

function resetAll(): void {
  resetSingletons()
  __resetBranchWriteLocks()
}

describe('a no-gate run holds the branch write lock through its write phase', () => {
  beforeEach(() => {
    resetAll()
    registerAllDomains()
  })
  afterEach(() => resetAll())

  it('holds a write from outside the run until the run commits', async () => {
    const { ctx } = await makeHarness()
    const burst = defineBurst('no-gate')
    const inflight = runPipeline('burst', ctx)
    burst.modelCall.open()
    await burst.firstLanded.opened

    const user = userWrite(ctx, 'hap_user')
    await pause(50)
    expect(user.settled()).toBe(false)
    expect(await happeningIds(ctx)).toEqual(['hap_run_1'])

    burst.midBurst.open()
    const tx = expectRan(await inflight)
    expect(tx.outcome).toBe('completed')
    const userPosition = await committedAt(user.write)
    const runPositions = await positionsOf(ctx, tx.actionId)
    expect(runPositions).toHaveLength(2)
    expect(userPosition).toBeGreaterThan(Math.max(...runPositions))
  })

  it('lets a write through while the run is still in its model call', async () => {
    const { ctx } = await makeHarness()
    const burst = defineBurst('no-gate')
    const inflight = runPipeline('burst', ctx)
    await burst.started.opened

    const userPosition = await committedAt(userWrite(ctx, 'hap_user').write)

    burst.modelCall.open()
    burst.midBurst.open()
    const tx = expectRan(await inflight)
    expect(tx.outcome).toBe('completed')
    expect(userPosition).toBeLessThan(Math.min(...(await positionsOf(ctx, tx.actionId))))
  })

  it("holds a write through the abort's reversal, then lands it beside nothing of the run's", async () => {
    const { ctx } = await makeHarness()
    let user: ReturnType<typeof userWrite> | undefined
    let settledAtReversal: boolean | undefined
    configurePort({
      reverseReplayDeltas: async (actionId, replayCtx, settleOps) => {
        // Room for a write freed too early to commit before the reversal does.
        await pause(50)
        const count = await reverseReplayDeltas(actionId, replayCtx, settleOps)
        settledAtReversal = user?.settled()
        return count
      },
    })
    const burst = defineBurst('no-gate', REFUSED)
    const inflight = runPipeline('burst', ctx)
    burst.modelCall.open()
    await burst.firstLanded.opened
    user = userWrite(ctx, 'hap_user')
    await pause(50)
    expect(user.settled()).toBe(false)

    burst.midBurst.open()
    const tx = expectRan(await inflight)
    expect(tx.outcome).toBe('failed')
    expect(settledAtReversal).toBe(false)
    await committedAt(user.write)
    expect(await positionsOf(ctx, tx.actionId)).toEqual([])
    expect(await positionsOf(ctx, 'act_user')).toHaveLength(1)
    expect(await happeningIds(ctx)).toEqual(['hap_user'])
  })

  it('ends the hold when the reversal itself fails, leaving the run to boot recovery', async () => {
    const { ctx } = await makeHarness()
    configurePort({
      reverseReplayDeltas: (actionId) =>
        Promise.reject(
          new DeltaReplayError('Reverse-replay failed', {
            cause: new Error('forced'),
            actionId,
            stage: 'transaction',
          }),
        ),
    })
    const burst = defineBurst('no-gate', REFUSED)
    const inflight = runPipeline('burst', ctx)
    burst.modelCall.open()
    await burst.firstLanded.opened
    const user = userWrite(ctx, 'hap_user')
    await pause(50)
    expect(user.settled()).toBe(false)

    burst.midBurst.open()
    expect(expectRan(await inflight).outcome).toBe('failed')
    await committedAt(user.write)
    // Unreversed: the run's write waits for boot recovery, beside the user's.
    expect(await happeningIds(ctx)).toEqual(['hap_run_1', 'hap_user'])
  })

  // A second exclusive request under the run's own actionId would wait on the first, which
  // commitRun releases only after every branch finishes: the run would never complete.
  it('takes one hold for two parallel branches writing, and completes', async () => {
    const { ctx } = await makeHarness()
    const writer = (id: string): PhaseFn =>
      async function* () {
        yield { type: 'delta_emitted', action: happening(id, 'periodic_classifier') }
        return { status: 'completed' }
      }
    definePipeline({
      kind: 'parallel-burst',
      phases: [
        {
          name: 'group',
          parallel: [
            { name: 'a', run: writer('hap_a') },
            { name: 'b', run: writer('hap_b') },
          ],
        },
      ],
      affordance: 'invisible',
      gateBehavior: 'no-gate',
      concurrencyPolicy: {},
    })

    const tx = expectRan(await within(runPipeline('parallel-burst', ctx), 2000))
    expect(tx.outcome).toBe('completed')
    expect(await happeningIds(ctx)).toEqual(['hap_a', 'hap_b'])
    // One release freed the branch, so no second hold is left behind.
    await committedAt(userWrite(ctx, 'hap_user').write)
  })

  // Promise.all rejects on the first throwing branch without waiting for siblings, so a sibling can
  // emit after the abort's reversal released the hold; a fresh hold then has no one to release it.
  it('refuses a late write from a parallel branch after the abort released, leaving the branch free', async () => {
    const { ctx } = await makeHarness()
    const dispatched: string[] = []
    configurePort({
      applyDeltaAction: (args, applyCtx) => {
        if (args.action.kind === 'createHappening') dispatched.push(args.action.payload.entry.id)
        return applyDeltaAction(args, applyCtx)
      },
    })
    const lateGo = gate()
    async function* thrower(): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
      yield { type: 'delta_emitted', action: happening('hap_early', 'periodic_classifier') }
      throw new Error('branch exploded')
    }
    async function* straggler(): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
      await lateGo.opened
      yield { type: 'delta_emitted', action: happening('hap_late', 'periodic_classifier') }
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'straggling-burst',
      phases: [
        {
          name: 'group',
          parallel: [
            { name: 'a', run: thrower },
            { name: 'b', run: straggler },
          ],
        },
      ],
      affordance: 'invisible',
      gateBehavior: 'no-gate',
      concurrencyPolicy: {},
    })

    const tx = expectRan(await within(runPipeline('straggling-burst', ctx), 2000))
    expect(tx.outcome).toBe('failed')
    expect(await happeningIds(ctx)).toEqual([])

    lateGo.open()
    await pause(50)
    expect(dispatched).toEqual(['hap_early'])
    expect(await happeningIds(ctx)).toEqual([])
    await committedAt(userWrite(ctx, 'hap_user').write)
  })

  // The failed branch's own result, not a refused sibling write, is what the run reports.
  it("drops a sibling's write after a branch failed, and reports the branch's failure", async () => {
    const { ctx } = await makeHarness()
    const dispatched: string[] = []
    configurePort({
      applyDeltaAction: (args, applyCtx) => {
        if (args.action.kind === 'createHappening') dispatched.push(args.action.payload.entry.id)
        return applyDeltaAction(args, applyCtx)
      },
    })
    const failedAt = gate()
    async function* failing(): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
      yield { type: 'delta_emitted', action: happening('hap_early', 'periodic_classifier') }
      failedAt.open()
      return { status: 'failed', error: { kind: 'phase-logic', detail: 'branch a gave up' } }
    }
    async function* sibling(): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
      await failedAt.opened
      await pause(20)
      yield { type: 'delta_emitted', action: happening('hap_late', 'periodic_classifier') }
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'failing-group',
      phases: [
        {
          name: 'group',
          parallel: [
            { name: 'a', run: failing },
            { name: 'b', run: sibling },
          ],
        },
      ],
      affordance: 'invisible',
      gateBehavior: 'no-gate',
      concurrencyPolicy: {},
    })

    const tx = expectRan(await within(runPipeline('failing-group', ctx), 2000))
    expect(tx.outcome).toBe('failed')
    expect(tx.error).toEqual({ kind: 'phase-logic', detail: 'branch a gave up' })
    expect(dispatched).toEqual(['hap_early'])
    expect(await happeningIds(ctx)).toEqual([])
    await committedAt(userWrite(ctx, 'hap_user').write)
  })

  // generation-pipeline.md → Prose reversals and the classifier barrier: a 'cancel' abort never reaches the commit burst.
  it("lets a burst land after a 'cancel' abort, as the sweep that follows expects", async () => {
    const { ctx } = await makeHarness()
    const burst = defineBurst('no-gate')
    const inflight = runPipeline('burst', ctx)
    burst.modelCall.open()
    await burst.firstLanded.opened
    generationStore.getTxState().runs.forEach((run) => run.abortController.abort())

    burst.midBurst.open()
    const tx = expectRan(await inflight)
    expect(tx.outcome).toBe('completed')
    expect(await happeningIds(ctx)).toEqual(['hap_run_1', 'hap_run_2'])
  })
})

describe('a hard-gate run takes no write hold', () => {
  beforeEach(() => {
    resetAll()
    registerAllDomains()
  })
  afterEach(() => resetAll())

  it("lets another run's write through mid-burst", async () => {
    const { ctx } = await makeHarness()
    const lock = spyOnLock()
    const burst = defineBurst('hard-gate')
    const inflight = runPipeline('burst', ctx)
    burst.modelCall.open()
    await burst.firstLanded.opened

    await committedAt(
      applyDeltaAction(
        {
          action: happening('hap_other', 'periodic_classifier'),
          actionId: 'act_other',
          branchId: 'b1',
        },
        ctx,
      ),
    )

    burst.midBurst.open()
    expect(expectRan(await inflight).outcome).toBe('completed')
    expect(lock).toEqual({ holds: [], releases: [] })
  })
})
