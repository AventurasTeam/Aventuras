import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type PipelineAction } from '@/lib/actions'
import { deltas, pipelineRuns, storyEntries } from '@/lib/db'
import { definePipeline, pipelineEventBus, runPipeline, type PhaseResult } from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

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
    expect((await db.select().from(deltas)).length).toBe(2)
  })
})
