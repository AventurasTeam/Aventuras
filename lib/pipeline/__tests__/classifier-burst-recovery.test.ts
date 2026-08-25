import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerAllDomains } from '@/lib/actions'
import { deltas, happenings, pipelineRuns } from '@/lib/db'
import { recoverInFlightRuns } from '@/lib/pipeline'

import { makeHarness, resetSingletons } from './harness'

// A crashed burst leaves committed happenings behind an unmoved watermark, so the
// next pass re-reads the same window. The pipeline_runs marker is what stops a
// duplicate: boot reverse-replays every delta sharing the orphan's action_id.
describe('a crashed classifier burst', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  it('has its committed happenings reversed at boot, so a re-run cannot duplicate them', async () => {
    const { db, ctx } = await makeHarness()
    registerAllDomains()

    await db.insert(pipelineRuns).values({
      runId: 'run_classifier',
      kind: 'periodic-classifier',
      actionId: 'act_burst',
      storyId: 's1',
      startedAt: 1,
    })

    // Two of the burst's happenings landed before the crash; the third never did.
    for (const [i, id] of ['hap_1', 'hap_2'].entries()) {
      await db.insert(happenings).values({
        id,
        branchId: 'b1',
        title: `landed ${id}`,
        commonKnowledge: 0,
        createdAt: 1,
        updatedAt: 1,
      })
      await db.insert(deltas).values({
        id: `delta_${id}`,
        branchId: 'b1',
        entryId: null,
        actionId: 'act_burst',
        logPosition: i + 1,
        source: 'ai_classifier',
        targetTable: 'happenings',
        targetId: id,
        op: 'create',
        undoPayload: null,
        encodingVersion: 1,
        createdAt: 1,
      })
    }

    expect(await db.select().from(happenings)).toHaveLength(2)

    const report = await recoverInFlightRuns(ctx)

    expect(report.failures).toHaveLength(0)
    expect(report.reversed).toHaveLength(1)
    expect(report.reversed[0]).toMatchObject({ kind: 'periodic-classifier', deltas: 2 })
    // The window is clean before the watermark re-reads it: nothing to duplicate.
    expect(await db.select().from(happenings)).toHaveLength(0)
    // The marker is settled, so a second boot cannot reverse the burst twice.
    const [marker] = await db.select().from(pipelineRuns)
    expect(marker.outcome).toBe('recovered')
    expect(marker.finishedAt).not.toBeNull()
  })
})
