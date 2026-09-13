import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type PipelineAction } from '@/lib/actions'
import { deltas, pipelineRuns, storyEntries } from '@/lib/db'
import { definePipeline, runPipeline, type PhaseResult } from '@/lib/pipeline'

import { expectRan, makeHarness, resetSingletons } from './harness'

const base = { affordance: 'invisible', gateBehavior: 'hard-gate', concurrencyPolicy: {} } as const

// create entry (delta 1) -> update its metadata (delta 2) -> fail.
async function* twoThenFail(): AsyncGenerator<
  { type: 'delta_emitted'; action: PipelineAction },
  PhaseResult
> {
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
          metadata: { sceneEntities: [], currentLocationId: null, worldTime: 5 },
          createdAt: 1,
        },
      },
    },
  }
  yield {
    type: 'delta_emitted',
    action: {
      kind: 'updateStoryEntryMetadata',
      source: 'ai_classifier',
      payload: {
        branchId: 'b1',
        id: 'entry_1',
        metadata: { sceneEntities: [], currentLocationId: null, worldTime: 9 },
      },
    },
  }
  return { status: 'failed', error: { kind: 'phase-logic', detail: 'synthetic fatal' } }
}

describe('orchestrator reverse-replay on abort', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  it('reverses both deltas (DESC) and marks the run failed', async () => {
    const { db, ctx } = await makeHarness()
    definePipeline({ kind: 'synthetic', phases: [{ name: 'only', run: twoThenFail }], ...base })

    const result = expectRan(await runPipeline('synthetic', ctx))

    expect(result.outcome).toBe('failed')
    // update reversed (worldTime back to 5) then create reversed (row deleted)
    const rows = await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, 'b1'), eq(storyEntries.id, 'entry_1')))
    expect(rows.length).toBe(0)
    // the reversal prunes the deltas it replays, as CTRL-Z does
    expect((await db.select().from(deltas)).length).toBe(0)
    const [pr] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, result.runId))
    expect(pr.outcome).toBe('failed')
    expect(pr.finishedAt).not.toBeNull()
  })
})
