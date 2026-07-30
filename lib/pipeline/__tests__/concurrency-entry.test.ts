import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  definePipeline,
  ensurePerTurnPipelineRegistered,
  ensurePeriodicClassifierPipelineRegistered,
  PERIODIC_CLASSIFIER_KIND,
  PER_TURN_KIND,
  runPipeline,
  type PhaseContext,
  type PhaseResult,
} from '@/lib/pipeline'
import { checkConcurrencyContract } from '@/lib/pipeline/runtime/concurrency'
import { awaitRunTerminal, generationStore, type RunState } from '@/lib/stores'

import { expectRan, makeHarness, resetSingletons } from './harness'

const base = { affordance: 'invisible', gateBehavior: 'no-gate' } as const

describe('runPipeline concurrency entry + coordination', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  it('lets a per-turn run start while the classifier is in flight, and blocks a second classifier', () => {
    // Asserted against the policies the two definitions actually register, not
    // hand-written stand-ins: per-turn's blockedBy lacks periodic-classifier,
    // and the classifier self-blocks.
    ensurePerTurnPipelineRegistered()
    ensurePeriodicClassifierPipelineRegistered()
    const inflight = (kind: string): Map<string, RunState> =>
      new Map([[`r_${kind}`, { runId: `r_${kind}`, kind } as RunState]])

    expect(
      checkConcurrencyContract(PER_TURN_KIND, inflight(PERIODIC_CLASSIFIER_KIND), false),
    ).toMatchObject({ kind: 'start' })
    expect(
      checkConcurrencyContract(PERIODIC_CLASSIFIER_KIND, inflight(PERIODIC_CLASSIFIER_KIND), false),
    ).toMatchObject({ kind: 'blocked' })
    expect(
      checkConcurrencyContract(PERIODIC_CLASSIFIER_KIND, inflight('chapter-close'), false),
    ).toMatchObject({ kind: 'blocked' })
  })

  it('rejects a start blocked by an in-flight run of a blocking kind', async () => {
    const { ctx } = await makeHarness()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    async function* waits(): AsyncGenerator<never, PhaseResult> {
      await gate
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'solo',
      phases: [{ name: 'p', run: waits }],
      concurrencyPolicy: { blockedBy: ['solo'] },
      ...base,
    })

    const inflight = runPipeline('solo', ctx) // sync-reserves 'solo', then hangs on the gate
    const blocked = await runPipeline('solo', ctx)
    expect(blocked).toEqual({ outcome: 'rejected', blockedBy: 'solo' })

    release()
    expect(expectRan(await inflight).outcome).toBe('completed')
  })

  it('awaitRunTerminal(cancel) aborts the in-flight run and resolves on its terminal', async () => {
    const { ctx } = await makeHarness()
    async function* waits({ abortSignal }: PhaseContext): AsyncGenerator<never, PhaseResult> {
      await new Promise<void>((resolve) => {
        if (abortSignal.aborted) resolve()
        else abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
      return { status: abortSignal.aborted ? 'aborted' : 'completed' }
    }
    definePipeline({
      kind: 'bg',
      phases: [{ name: 'p', run: waits }],
      concurrencyPolicy: {},
      ...base,
    })

    const inflight = runPipeline('bg', ctx)
    await awaitRunTerminal('bg', 'cancel')
    expect(expectRan(await inflight).outcome).toBe('aborted')
    expect(generationStore.getTxState().runs.size).toBe(0)
  })

  it('awaitRunTerminal(finish) awaits the natural commit without aborting', async () => {
    const { ctx } = await makeHarness()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    async function* waits(): AsyncGenerator<never, PhaseResult> {
      await gate
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'bg',
      phases: [{ name: 'p', run: waits }],
      concurrencyPolicy: {},
      ...base,
    })

    const inflight = runPipeline('bg', ctx)
    let resolved = false
    const waiter = awaitRunTerminal('bg', 'finish').then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false) // still running — finish does not abort
    release()
    await waiter
    expect(resolved).toBe(true)
    expect(expectRan(await inflight).outcome).toBe('completed')
  })

  it('awaitRunTerminal no-ops when no run of the kind is in flight', async () => {
    await expect(awaitRunTerminal('absent', 'cancel')).resolves.toBeUndefined()
  })

  it('start-after-yields aborts the yielding run before starting the incoming one', async () => {
    const { ctx } = await makeHarness()
    // bg only ends by abort; pre-check aborted so a yield that fires before the
    // phase registers its listener isn't missed.
    async function* bgPhase({ abortSignal }: PhaseContext): AsyncGenerator<never, PhaseResult> {
      await new Promise<void>((resolve) => {
        if (abortSignal.aborted) resolve()
        else abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
      return { status: abortSignal.aborted ? 'aborted' : 'completed' }
    }
    async function* fgPhase(): AsyncGenerator<never, PhaseResult> {
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'bg',
      phases: [{ name: 'p', run: bgPhase }],
      concurrencyPolicy: { yieldsTo: ['fg'] },
      ...base,
    })
    definePipeline({
      kind: 'fg',
      phases: [{ name: 'p', run: fgPhase }],
      concurrencyPolicy: {},
      ...base,
    })

    const bg = runPipeline('bg', ctx)
    const fg = expectRan(await runPipeline('fg', ctx))
    expect(fg.outcome).toBe('completed')
    expect((await bg).outcome).toBe('aborted') // bg was yielded (aborted) before fg started
  })

  it('start-after-yields re-checks after the wait: a blocker that slips in rejects the start', async () => {
    const { ctx } = await makeHarness()
    let releaseBlocker!: () => void
    const blockerGate = new Promise<void>((r) => {
      releaseBlocker = r
    })
    let blockerInflight: Promise<unknown> | undefined

    async function* blockerPhase(): AsyncGenerator<never, PhaseResult> {
      await blockerGate
      return { status: 'completed' }
    }
    // While fg awaits bg's terminal (the yield), bg slips a 'blocker' run into
    // txState — a kind fg.blockedBy lists. A stale entry path reserves fg anyway;
    // a correct one re-checks after the wait and rejects it.
    async function* bgPhase({ abortSignal }: PhaseContext): AsyncGenerator<never, PhaseResult> {
      await new Promise<void>((resolve) => {
        if (abortSignal.aborted) resolve()
        else abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
      blockerInflight = runPipeline('blocker', ctx)
      return { status: 'aborted' }
    }
    async function* fgPhase(): AsyncGenerator<never, PhaseResult> {
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'blocker',
      phases: [{ name: 'p', run: blockerPhase }],
      concurrencyPolicy: {},
      ...base,
    })
    definePipeline({
      kind: 'bg',
      phases: [{ name: 'p', run: bgPhase }],
      concurrencyPolicy: { yieldsTo: ['fg'] },
      ...base,
    })
    definePipeline({
      kind: 'fg',
      phases: [{ name: 'p', run: fgPhase }],
      concurrencyPolicy: { blockedBy: ['blocker'] },
      ...base,
    })

    const bg = runPipeline('bg', ctx)
    const fg = await runPipeline('fg', ctx)
    expect(fg).toEqual({ outcome: 'rejected', blockedBy: 'blocker' })
    expect((await bg).outcome).toBe('aborted')

    releaseBlocker()
    await blockerInflight
  })

  it('two non-blocking runs keep isolated context across interleaving', async () => {
    const { ctx } = await makeHarness()
    let releaseA!: () => void
    const aGate = new Promise<void>((r) => {
      releaseA = r
    })
    const seen: { phase: string; actionId: string; who: unknown }[] = []

    // A reads its context, parks, then re-reads after resume. Under the old global
    // active-run, the second read would see B (which started and finished meanwhile);
    // with run-scoped context it stays A's.
    async function* aPhase(ac: PhaseContext): AsyncGenerator<never, PhaseResult> {
      ac.intermediates.who = 'A'
      seen.push({ phase: 'A:before', actionId: ac.actionId, who: ac.intermediates.who })
      await aGate
      seen.push({ phase: 'A:after', actionId: ac.actionId, who: ac.intermediates.who })
      return { status: 'completed' }
    }
    async function* bPhase(bc: PhaseContext): AsyncGenerator<never, PhaseResult> {
      bc.intermediates.who = 'B'
      seen.push({ phase: 'B', actionId: bc.actionId, who: bc.intermediates.who })
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'A',
      phases: [{ name: 'p', run: aPhase }],
      concurrencyPolicy: {},
      ...base,
    })
    definePipeline({
      kind: 'B',
      phases: [{ name: 'p', run: bPhase }],
      concurrencyPolicy: {},
      ...base,
    })

    const aRun = runPipeline('A', ctx) // starts, parks on aGate
    const bRun = expectRan(await runPipeline('B', ctx)) // runs to completion while A parks
    releaseA()
    const aResult = expectRan(await aRun)

    const aBefore = seen.find((s) => s.phase === 'A:before')!
    const aAfter = seen.find((s) => s.phase === 'A:after')!
    const b = seen.find((s) => s.phase === 'B')!

    expect(aResult.actionId).not.toBe(bRun.actionId)
    expect(aBefore.actionId).toBe(aResult.actionId)
    expect(aAfter.actionId).toBe(aResult.actionId) // not clobbered by B's interleaving
    expect(aAfter.who).toBe('A') // intermediates isolated — B's write didn't bleed in
    expect(b.actionId).toBe(bRun.actionId)
  })
})
