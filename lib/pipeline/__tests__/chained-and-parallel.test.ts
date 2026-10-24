import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type PipelineAction } from '@/lib/actions'
import { deltas, pipelineRuns, storyEntries } from '@/lib/db'
import { getDiagnosticsSnapshot } from '@/lib/diagnostics'
import {
  __resetRegistry,
  definePipeline,
  pipelineEventBus,
  runPipeline,
  startPipeline,
  type PhaseContext,
  type PhaseResult,
  type Pipeline,
  type RunCtx,
} from '@/lib/pipeline'
import { generationStore, type RunState } from '@/lib/stores'

import { expectRan, makeHarness, resetSingletons } from './harness'

const base = { affordance: 'invisible', gateBehavior: 'hard-gate', concurrencyPolicy: {} } as const

async function* noop(): AsyncGenerator<never, PhaseResult> {
  return { status: 'completed' }
}

function createEntry(id: string): { type: 'delta_emitted'; action: PipelineAction } {
  return {
    type: 'delta_emitted',
    action: {
      kind: 'createStoryEntry',
      source: 'ai_classifier',
      payload: {
        entry: { id, branchId: 'b1', position: 1, kind: 'ai_reply', content: id, createdAt: 1 },
      },
    },
  }
}

async function* entryThen(
  id: string,
  outcome: PhaseResult,
): AsyncGenerator<ReturnType<typeof createEntry>, PhaseResult> {
  yield createEntry(id)
  return outcome
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const logged = (kind: string) => getDiagnosticsSnapshot().logEntries.some((e) => e.kind === kind)

// These pipelines insert nothing but their pipeline_runs markers, so every insert is one.
function failingMarkerInsert(db: RunCtx['db'], kind: string): RunCtx['db'] {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'insert') return Reflect.get(target, prop, receiver) as unknown
      return () => ({
        values: (row: typeof pipelineRuns.$inferInsert) =>
          row.kind === kind
            ? Promise.reject(new Error('marker insert failed'))
            : target.insert(pipelineRuns).values(row),
      })
    },
  })
}

type Complete = { kind: string; outcome: string; idle: boolean; error?: unknown }

// `idle` is what the drain worker reads at each run_complete.
function recordCompletes(): Complete[] {
  const seen: Complete[] = []
  pipelineEventBus.subscribe('run_complete', (e) => {
    seen.push({
      kind: e.kind,
      outcome: e.outcome,
      idle: !generationStore.hasActiveRun(),
      ...(e.error ? { error: e.error } : {}),
    })
  })
  return seen
}

const markerUnwound = (kind: string): Complete => ({
  kind,
  outcome: 'failed',
  idle: true,
  error: { kind: 'orchestrator', detail: expect.stringMatching(/^marker insert failed: /) },
})

function heldPhase(): { run: () => AsyncGenerator<never, PhaseResult>; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    run: async function* () {
      await gate
      return { status: 'completed' }
    },
    release: () => release(),
  }
}

describe('chained transition', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  function defineChain(): void {
    definePipeline({ kind: 'succ', phases: [{ name: 'p', run: noop }], ...base })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: noop }],
      chainsTo: () => 'succ',
      ...base,
    })
  }

  it('drives the chained successor to completion and clears the map', async () => {
    const { db, ctx } = await makeHarness()
    defineChain()

    const starts: string[] = []
    const completes: string[] = []
    const offStart = pipelineEventBus.subscribe('run_start', (e) => starts.push(e.kind))
    const offComplete = pipelineEventBus.subscribe('run_complete', (e) => completes.push(e.kind))
    const result = expectRan(await runPipeline('pred', ctx))
    offStart()
    offComplete()

    expect(result.outcome).toBe('completed')
    // returns the ORIGIN run's result, not the successor's
    const [originRow] = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.runId, result.runId))
    expect(originRow.kind).toBe('pred')

    expect(starts).toEqual(['pred', 'succ']) // both ran, predecessor first
    expect(completes).toEqual(['pred', 'succ'])

    const rows = await db.select().from(pipelineRuns)
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.outcome === 'completed' && r.finishedAt !== null)).toBe(true)

    expect(generationStore.getTxState().runs.size).toBe(0) // successor executed and cleared
  })

  it('hands the origin run its inputs and the chained successor none', async () => {
    const { ctx } = await makeHarness()
    const seen: unknown[] = []
    async function* record({ inputs }: PhaseContext): AsyncGenerator<never, PhaseResult> {
      seen.push(inputs)
      return { status: 'completed' }
    }
    definePipeline({ kind: 'succ', phases: [{ name: 'p', run: record }], ...base })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: record }],
      chainsTo: () => 'succ',
      ...base,
    })

    await runPipeline('pred', { ...ctx, inputs: { note: 'origin-only' } })

    // A chained kind has its own context; inheriting the predecessor's inputs
    // would feed it parameters shaped for a different pipeline.
    expect(seen).toEqual([{ note: 'origin-only' }, undefined])
  })

  it('keeps a hard-gate run present across the transition (no edit window)', async () => {
    const { ctx } = await makeHarness()
    defineChain()

    let blockedAtPredComplete: boolean | null = null
    const off = pipelineEventBus.subscribe('run_complete', (e) => {
      if (e.kind === 'pred') blockedAtPredComplete = generationStore.isUserEditBlocked()
    })
    await runPipeline('pred', ctx)
    off()

    // at the instant pred completes, the hard-gate successor is already swapped in
    expect(blockedAtPredComplete).toBe(true)
  })

  // generation-pipeline.md → chainsTo on predecessor: a chained run never inherits its
  // predecessor's actionId, or undoing (or reversing) one would take the other with it.
  it('gives a chained run its own actionId when the start passed one', async () => {
    const { db, ctx } = await makeHarness()
    defineChain()

    const result = expectRan(await runPipeline('pred', { ...ctx, actionId: 'act_turn' }))

    expect(result.actionId).toBe('act_turn')
    const rows = await db.select().from(pipelineRuns)
    const succ = rows.find((r) => r.kind === 'succ')
    expect(succ).toBeDefined()
    expect(succ?.actionId).not.toBe('act_turn')
  })

  // A successor is handed the origin's ctx, so its hook must read the run's own actionId.
  it("hands a successor's onPhaseException its own actionId, not the start's", async () => {
    const { ctx } = await makeHarness()
    const seen: (string | undefined)[] = []
    const completes: { kind: string; actionId: string }[] = []
    pipelineEventBus.subscribe('run_complete', (e) => {
      completes.push({ kind: e.kind, actionId: e.actionId })
    })
    async function* updateMissing(): AsyncGenerator<ReturnType<typeof createEntry>, PhaseResult> {
      yield {
        type: 'delta_emitted',
        action: {
          kind: 'updateStoryEntryMetadata',
          source: 'ai_classifier',
          payload: {
            branchId: 'b1',
            id: 'ghost',
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: 1 },
          },
        },
      }
      return { status: 'completed' }
    }
    definePipeline({
      kind: 'succ',
      phases: [{ name: 'p', run: updateMissing }],
      onPhaseException: async (hookCtx) => {
        seen.push(hookCtx.actionId)
      },
      ...base,
    })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: noop }],
      chainsTo: () => 'succ',
      ...base,
    })

    expectRan(await runPipeline('pred', { ...ctx, actionId: 'act_turn' }))

    const succComplete = completes.find((c) => c.kind === 'succ')
    expect(succComplete?.actionId).not.toBe('act_turn')
    expect(seen).toEqual([succComplete?.actionId])
  })

  it('reports a failed successor of a beforeTurn start as not beforeTurn', async () => {
    const { ctx } = await makeHarness()
    definePipeline({
      kind: 'succ',
      phases: [
        {
          name: 'p',
          run: () =>
            entryThen('entry_succ_fail', {
              status: 'failed',
              error: { kind: 'phase-logic', detail: 'boom' },
            }),
        },
      ],
      ...base,
    })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: noop }],
      chainsTo: () => 'succ',
      ...base,
    })
    const seen: { kind: string; outcome: string; beforeTurn: boolean }[] = []
    pipelineEventBus.subscribe('run_complete', (e) => {
      seen.push({ kind: e.kind, outcome: e.outcome, beforeTurn: e.beforeTurn })
    })

    expectRan(await runPipeline('pred', { ...ctx, beforeTurn: true }))

    expect(seen).toEqual([
      { kind: 'pred', outcome: 'completed', beforeTurn: true },
      { kind: 'succ', outcome: 'failed', beforeTurn: false },
    ])
  })

  it('a failing successor of a start with an actionId reverses only its own deltas', async () => {
    const { db, ctx } = await makeHarness()
    definePipeline({
      kind: 'succ',
      phases: [
        {
          name: 'p',
          run: () =>
            entryThen('entry_succ', {
              status: 'failed',
              error: { kind: 'phase-logic', detail: 'succ fail' },
            }),
        },
      ],
      ...base,
    })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: () => entryThen('entry_pred', { status: 'completed' }) }],
      chainsTo: () => 'succ',
      ...base,
    })

    const result = await runPipeline('pred', { ...ctx, actionId: 'act_turn' })

    expect(result.outcome).toBe('completed')
    const entries = await db.select().from(storyEntries)
    expect(entries.map((e) => e.id)).toEqual(['entry_pred'])
  })

  it('marks only the started run as Send work, never its successor', async () => {
    const { ctx } = await makeHarness()
    const seen: Record<string, boolean | undefined> = {}
    async function* record({ actionId }: PhaseContext): AsyncGenerator<never, PhaseResult> {
      const own = [...generationStore.getTxState().runs.values()].find(
        (r) => r.actionId === actionId,
      )
      if (own) seen[own.kind] = own.beforeTurn
      return { status: 'completed' }
    }
    definePipeline({ kind: 'succ', phases: [{ name: 'p', run: record }], ...base })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: record }],
      chainsTo: () => 'succ',
      ...base,
    })

    await runPipeline('pred', { ...ctx, beforeTurn: true })

    expect(seen).toEqual({ pred: true, succ: false })
  })

  it("names beforeTurn on the started run's run_complete, never on its successor's", async () => {
    const { ctx } = await makeHarness()
    defineChain()
    const seen: { kind: string; beforeTurn: boolean }[] = []
    pipelineEventBus.subscribe('run_complete', (e) => {
      seen.push({ kind: e.kind, beforeTurn: e.beforeTurn })
    })

    expectRan(await runPipeline('pred', { ...ctx, beforeTurn: true }))

    expect(seen).toEqual([
      { kind: 'pred', beforeTurn: true },
      { kind: 'succ', beforeTurn: false },
    ])
  })

  it('awaits an async chainsTo while the committing run still holds the gate', async () => {
    const { ctx } = await makeHarness()
    const seen: { registered: boolean; blocked: boolean; markers: number }[] = []
    definePipeline({ kind: 'succ', phases: [{ name: 'p', run: noop }], ...base })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: noop }],
      chainsTo: async (run, dbCtx) => {
        const markers = await dbCtx.db.select().from(pipelineRuns)
        seen.push({
          registered: generationStore.getTxState().runs.has(run.runId),
          blocked: generationStore.isUserEditBlocked(),
          markers: markers.length,
        })
        return 'succ'
      },
      ...base,
    })

    const starts: string[] = []
    const off = pipelineEventBus.subscribe('run_start', (e) => starts.push(e.kind))
    await runPipeline('pred', ctx)
    off()

    expect(seen).toEqual([{ registered: true, blocked: true, markers: 1 }])
    expect(starts).toEqual(['pred', 'succ'])
  })

  it('an abort landing during the chainsTo read commits the run and chains nothing', async () => {
    const { db, ctx } = await makeHarness()
    let entered!: (run: RunState) => void
    const inChainsTo = new Promise<RunState>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    definePipeline({ kind: 'succ', phases: [{ name: 'p', run: noop }], ...base })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: () => entryThen('entry_pred', { status: 'completed' }) }],
      chainsTo: async (run) => {
        entered(run)
        await held
        return 'succ'
      },
      ...base,
    })
    const starts: string[] = []
    const off = pipelineEventBus.subscribe('run_start', (e) => starts.push(e.kind))

    const running = runPipeline('pred', ctx)
    const run = await inChainsTo
    run.abortController.abort()
    release()
    const result = expectRan(await running)
    off()

    expect(result.outcome).toBe('completed')
    expect((await db.select().from(storyEntries)).map((e) => e.id)).toEqual(['entry_pred'])
    const rows = await db.select().from(pipelineRuns)
    expect(rows.map((r) => [r.kind, r.outcome])).toEqual([['pred', 'completed']])
    expect(starts).toEqual(['pred'])
    expect(generationStore.getTxState().runs.size).toBe(0)
  })

  it('does not evaluate chainsTo for a run cancelled in its last phase', async () => {
    const { ctx } = await makeHarness()
    let chainReads = 0
    async function* cancelledLate({ actionId }: PhaseContext): AsyncGenerator<never, PhaseResult> {
      const own = [...generationStore.getTxState().runs.values()].find(
        (r) => r.actionId === actionId,
      )
      own?.abortController.abort()
      return { status: 'completed' }
    }
    definePipeline({ kind: 'succ', phases: [{ name: 'p', run: noop }], ...base })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: cancelledLate }],
      chainsTo: () => {
        chainReads++
        return 'succ'
      },
      ...base,
    })

    const result = expectRan(await runPipeline('pred', ctx))

    expect(result.outcome).toBe('completed')
    expect(chainReads).toBe(0)
    expect(generationStore.getTxState().runs.size).toBe(0)
  })

  const failingChains: [string, NonNullable<Pipeline['chainsTo']>][] = [
    [
      'throws',
      () => {
        throw new Error('chain read failed')
      },
    ],
    ['rejects', () => Promise.reject(new Error('chain read failed'))],
  ]

  it.each(failingChains)(
    'a chainsTo that %s commits the run and chains nothing',
    async (_, chainsTo) => {
      const { db, ctx } = await makeHarness()
      definePipeline({ kind: 'succ', phases: [{ name: 'p', run: noop }], ...base })
      definePipeline({
        kind: 'pred',
        phases: [{ name: 'p', run: () => entryThen('entry_pred', { status: 'completed' }) }],
        chainsTo,
        ...base,
      })

      const result = expectRan(await runPipeline('pred', ctx))

      expect(result.outcome).toBe('completed')
      expect((await db.select().from(storyEntries)).map((e) => e.id)).toEqual(['entry_pred'])
      const rows = await db.select().from(pipelineRuns)
      expect(rows.map((r) => [r.kind, r.outcome])).toEqual([['pred', 'completed']])
      expect(generationStore.getTxState().runs.size).toBe(0)
      expect(logged('pipeline.chain_eval_failed')).toBe(true)
    },
  )

  it('a failing successor reverses only its own deltas; predecessor stays committed', async () => {
    const { db, ctx } = await makeHarness()
    const succFail: PhaseResult = {
      status: 'failed',
      error: { kind: 'phase-logic', detail: 'succ fail' },
    }
    definePipeline({
      kind: 'succ',
      phases: [{ name: 'p', run: () => entryThen('entry_succ', succFail) }],
      ...base,
    })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: () => entryThen('entry_pred', { status: 'completed' }) }],
      chainsTo: () => 'succ',
      ...base,
    })

    const result = await runPipeline('pred', ctx)

    expect(result.outcome).toBe('completed') // origin (pred) committed
    const entries = await db.select().from(storyEntries)
    expect(entries.map((e) => e.id)).toEqual(['entry_pred']) // succ's entry reversed
    expect(generationStore.getTxState().runs.size).toBe(0)
  })
})

describe('split start', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  function defineHeldChain(): () => void {
    const held = heldPhase()
    definePipeline({ kind: 'succ', phases: [{ name: 'p', run: held.run }], ...base })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: noop }],
      chainsTo: () => 'succ',
      ...base,
    })
    return held.release
  }

  it('settles origin at the starting run commit while its successor runs on', async () => {
    const { db, ctx } = await makeHarness()
    const release = defineHeldChain()

    const { origin, chain } = startPipeline('pred', ctx)
    let chainEnded = false
    void chain.then(() => {
      chainEnded = true
    })

    const result = expectRan(await origin)
    expect(result.outcome).toBe('completed')
    const [originRow] = await db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.runId, result.runId))
    expect(originRow.kind).toBe('pred')
    expect([...generationStore.getTxState().runs.values()].map((r) => r.kind)).toEqual(['succ'])
    await flush()
    expect(chainEnded).toBe(false)

    release()
    await chain
    expect(chainEnded).toBe(true)
    expect(generationStore.getTxState().runs.size).toBe(0)
  })

  it('runPipeline still resolves only once the whole chain has ended', async () => {
    const { ctx } = await makeHarness()
    const release = defineHeldChain()

    let done = false
    const running = runPipeline('pred', ctx).then((r) => {
      done = true
      return r
    })
    await flush()
    expect(done).toBe(false)
    expect([...generationStore.getTxState().runs.values()].map((r) => r.kind)).toEqual(['succ'])

    release()
    expect(expectRan(await running).outcome).toBe('completed')
    expect(generationStore.getTxState().runs.size).toBe(0)
  })

  it('rejects origin when the starting run cannot write its marker; chain still settles', async () => {
    const { ctx } = await makeHarness()
    definePipeline({ kind: 'pred', phases: [{ name: 'p', run: noop }], ...base })
    const db = failingMarkerInsert(ctx.db, 'pred')

    const completes = recordCompletes()

    const { origin, chain } = startPipeline('pred', { ...ctx, db })

    await expect(origin).rejects.toThrow('marker insert failed')
    await expect(chain).resolves.toBeUndefined()
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(completes).toEqual([markerUnwound('pred')])
    await expect(runPipeline('pred', { ...ctx, db })).rejects.toThrow('marker insert failed')
  })

  it('names beforeTurn on the run_complete of a start whose marker insert fails', async () => {
    const { ctx } = await makeHarness()
    definePipeline({ kind: 'pred', phases: [{ name: 'p', run: noop }], ...base })
    const db = failingMarkerInsert(ctx.db, 'pred')
    const seen: boolean[] = []
    pipelineEventBus.subscribe('run_complete', (e) => {
      seen.push(e.beforeTurn)
    })

    await expect(runPipeline('pred', { ...ctx, db, beforeTurn: true })).rejects.toThrow(
      'marker insert failed',
    )

    expect(seen).toEqual([true])
  })

  it('unwinds a successor whose marker insert fails and ends the chain', async () => {
    const { db: rawDb, ctx } = await makeHarness()
    definePipeline({ kind: 'succ', phases: [{ name: 'p', run: noop }], ...base })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: noop }],
      chainsTo: () => 'succ',
      ...base,
    })
    const db = failingMarkerInsert(ctx.db, 'succ')
    let successor: RunState | undefined
    pipelineEventBus.subscribe('run_complete', (e) => {
      if (e.kind === 'pred') successor = [...generationStore.getTxState().runs.values()][0]
    })
    const completes = recordCompletes()

    const { origin, chain } = startPipeline('pred', { ...ctx, db })

    expect(expectRan(await origin).outcome).toBe('completed')
    await expect(chain).resolves.toBeUndefined()
    expect(successor?.kind).toBe('succ')
    // Pred's run_complete fires with succ still registered, so only succ's reports idle.
    expect(completes).toEqual([
      { kind: 'pred', outcome: 'completed', idle: false },
      markerUnwound('succ'),
    ])
    const ended = await Promise.race([
      successor!.terminal.then(() => 'ended'),
      flush().then(() => 'pending'),
    ])
    expect(ended).toBe('ended')
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.isUserEditBlocked()).toBe(false)
    expect((await rawDb.select().from(pipelineRuns)).map((r) => r.kind)).toEqual(['pred'])
    expect(logged('pipeline.chain_start_failed')).toBe(true)
  })

  // Contrived trigger: with its kind unregistered mid-run, the successor's commit lookup throws.
  // The point is the contract: a successor's throw never reaches the origin's caller.
  it('ends the chain without rejecting when a successor drive throws', async () => {
    const { ctx } = await makeHarness()
    async function* dropsRegistry(): AsyncGenerator<never, PhaseResult> {
      __resetRegistry()
      return { status: 'completed' }
    }
    definePipeline({ kind: 'succ', phases: [{ name: 'p', run: dropsRegistry }], ...base })
    definePipeline({
      kind: 'pred',
      phases: [{ name: 'p', run: noop }],
      chainsTo: () => 'succ',
      ...base,
    })

    let successor: RunState | undefined
    pipelineEventBus.subscribe('run_complete', (e) => {
      if (e.kind === 'pred') successor = [...generationStore.getTxState().runs.values()][0]
    })
    const completes = recordCompletes()
    const { origin, chain } = startPipeline('pred', ctx)

    expect(expectRan(await origin).outcome).toBe('completed')
    await expect(chain).resolves.toBeUndefined()
    expect(logged('pipeline.chain_run_failed')).toBe(true)
    // Unwound like a failed marker insert: otherwise it holds the gate until a restart.
    expect(completes).toEqual([
      { kind: 'pred', outcome: 'completed', idle: false },
      {
        kind: 'succ',
        outcome: 'failed',
        idle: true,
        error: { kind: 'orchestrator', detail: expect.stringMatching(/^run threw: /) },
      },
    ])
    const ended = await Promise.race([
      successor!.terminal.then(() => 'ended'),
      flush().then(() => 'pending'),
    ])
    expect(ended).toBe('ended')
    expect(generationStore.isUserEditBlocked()).toBe(false)
  })
})

describe('parallel group', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  it('a failing branch aborts the run and reverse-replays every branch delta', async () => {
    const { db, ctx } = await makeHarness()
    async function* branchA(): AsyncGenerator<ReturnType<typeof createEntry>, PhaseResult> {
      yield createEntry('entry_a')
      return { status: 'completed' }
    }
    async function* branchB(): AsyncGenerator<ReturnType<typeof createEntry>, PhaseResult> {
      yield createEntry('entry_b')
      return { status: 'failed', error: { kind: 'phase-logic', detail: 'branch fail' } }
    }
    definePipeline({
      kind: 'synthetic',
      phases: [
        {
          name: 'group',
          parallel: [
            { name: 'a', run: branchA },
            { name: 'b', run: branchB },
          ],
        },
      ],
      ...base,
    })

    const result = await runPipeline('synthetic', ctx)
    expect(result.outcome).toBe('failed')
    expect((await db.select().from(storyEntries)).length).toBe(0) // both branch deltas reversed
    expect((await db.select().from(deltas)).length).toBe(0) // and pruned with the reversal
  })
})
