import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction, settleUserWrites } from '@/lib/actions/delta/apply-delta-action'
import {
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
  withBranchWriteShared,
} from '@/lib/actions/delta/branch-write-lock'
import { DeltaReplayError } from '@/lib/actions/delta/replay-errors'
import { describeDeltaReplayError, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { happenings } from '@/lib/db'
import {
  configureDeltaActionPort,
  definePipeline,
  startPipeline,
  type DeltaActionPort,
  type PhaseContext,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { generationStore, type DeferredWorkKind } from '@/lib/stores'

import { makeHarness, resetSingletons } from './harness'

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// A hold that never ends fails with a name, not by vitest's timeout.
async function within<T>(promise: Promise<T>, what: string, ms = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: still pending after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function configurePort(over: Partial<DeltaActionPort>): void {
  configureDeltaActionPort({
    applyDeltaAction,
    reverseReplayDeltas,
    describeReplayError: describeDeltaReplayError,
    settleUserWrites,
    holdBranchWriteExclusive,
    releaseBranchWriteExclusive,
    ...over,
  })
}

const grantedWithin = (what: string) =>
  within(
    withBranchWriteShared('b1', 'probe', async () => 'granted' as const),
    what,
  )

function defineRun(kind: string, interruptible?: DeferredWorkKind): { landed: Promise<void> } {
  let land!: () => void
  const landed = new Promise<void>((resolve) => {
    land = resolve
  })
  async function* writeThenWait(ctx: PhaseContext): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
    yield {
      type: 'delta_emitted',
      action: {
        kind: 'createHappening',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: 'hap_run',
            branchId: ctx.branchId,
            title: 'A fact',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
    }
    land()
    await new Promise<void>((resolve) => {
      if (ctx.abortSignal.aborted) resolve()
      else ctx.abortSignal.addEventListener('abort', () => resolve(), { once: true })
    })
    return { status: 'aborted' }
  }
  definePipeline({
    kind,
    phases: [{ name: 'run', run: writeThenWait }],
    affordance: 'pill-and-banner',
    gateBehavior: 'hard-gate',
    interruptible,
    concurrencyPolicy: {},
  })
  return { landed }
}

function abortRuns(): void {
  for (const run of generationStore.getTxState().runs.values()) run.abortController.abort()
}

function openPreview(): { end: () => void; done: Promise<void> } {
  let end!: () => void
  const done = withBranchWriteShared(
    'b1',
    'rollback-preview',
    () =>
      new Promise<void>((resolve) => {
        end = resolve
      }),
  )
  return { end: () => end(), done }
}

// generation-pipeline.md → Branch write lock: no reversal lands between a preview's reads.
describe("an interruptible run's abort reversal and the branch write lock", () => {
  beforeEach(() => {
    resetSingletons()
  })
  afterEach(() => {
    resetSingletons()
  })

  it('waits for a preview in progress before it reverses', async () => {
    const { db, ctx } = await makeHarness()
    const { landed } = defineRun(PERIODIC_CLASSIFIER_KIND, 'pass')
    const run = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await landed
    const preview = openPreview()

    abortRuns()
    await pause(20)
    expect(await db.select().from(happenings)).toHaveLength(1)

    preview.end()
    await within(preview.done, 'preview')
    expect(await within(run.origin, 'abort')).toMatchObject({ outcome: 'aborted' })
    expect(await db.select().from(happenings)).toEqual([])
  })

  it('keeps a preview that starts during the reversal out until it commits', async () => {
    const { db, ctx } = await makeHarness()
    let entered!: () => void
    const reversing = new Promise<void>((resolve) => {
      entered = resolve
    })
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const slowReverse: DeltaActionPort['reverseReplayDeltas'] = async (...args) => {
      entered()
      await finished
      return reverseReplayDeltas(...args)
    }
    configurePort({ reverseReplayDeltas: slowReverse })
    const { landed } = defineRun(PERIODIC_CLASSIFIER_KIND, 'pass')
    const run = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await landed

    abortRuns()
    await reversing
    const seen: number[] = []
    const preview = withBranchWriteShared('b1', 'rollback-preview', async () => {
      seen.push((await db.select().from(happenings)).length)
    })
    await pause(20)
    expect(seen).toEqual([])

    finish()
    await within(run.origin, 'abort')
    await within(preview, 'preview')
    expect(seen).toEqual([0])
  })

  it('takes no hold for a run that is not interruptible', async () => {
    const { db, ctx } = await makeHarness()
    const { landed } = defineRun('turn-stand-in')
    const run = startPipeline('turn-stand-in', ctx)
    await landed
    const preview = openPreview()

    abortRuns()
    expect(await within(run.origin, 'abort behind a preview')).toMatchObject({
      outcome: 'aborted',
    })
    expect(await db.select().from(happenings)).toEqual([])

    preview.end()
    await within(preview.done, 'preview')
  })

  // A leaked exclusive hold stalls every write to the branch until boot.
  it('releases the hold when the reversal fails and boot recovery owns the run', async () => {
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
    const { landed } = defineRun(PERIODIC_CLASSIFIER_KIND, 'pass')
    const run = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await landed

    abortRuns()
    expect(await within(run.origin, 'abort')).toMatchObject({ outcome: 'failed' })
    expect(await grantedWithin('a write after the failed reversal')).toBe('granted')
  })

  it('releases the hold when the reversal throws something the orchestrator does not recognise', async () => {
    const { ctx } = await makeHarness()
    configurePort({ reverseReplayDeltas: () => Promise.reject(new Error('not a replay error')) })
    const { landed } = defineRun(PERIODIC_CLASSIFIER_KIND, 'pass')
    const run = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await landed

    abortRuns()
    // Today's rethrow leaves the run registered (parked.md → An abort waits on its phases, except a
    // thrown parallel branch).
    await expect(within(run.origin, 'abort')).rejects.toThrow('not a replay error')
    expect(await grantedWithin('a write after the thrown reversal')).toBe('granted')
  })
})
