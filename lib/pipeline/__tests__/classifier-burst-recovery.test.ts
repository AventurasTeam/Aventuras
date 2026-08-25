import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerAllDomains, resetStuckClassifierRunState } from '@/lib/actions'
import { branches, deltas, happenings, pipelineRuns, type ClassifierStatus } from '@/lib/db'
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

  // The mirror: when the reversal itself fails the window is NOT clean, so the
  // branch must not be handed back to the cadence — 'running' is what suspends it.
  it('stays un-reconciled when its deltas could not be reversed', async () => {
    const { db, ctx } = await makeHarness()
    registerAllDomains()

    const running: ClassifierStatus = {
      state: 'running',
      lastSuccessAt: null,
      lastError: null,
      retryCount: 0,
      processedThrough: 4,
    }
    await db.update(branches).set({ classifierStatus: running }).where(eq(branches.id, 'b1'))
    await db.insert(pipelineRuns).values({
      runId: 'run_classifier',
      kind: 'periodic-classifier',
      actionId: 'act_burst',
      storyId: 's1',
      startedAt: 1,
    })
    await db.insert(happenings).values({
      id: 'hap_1',
      branchId: 'b1',
      title: 'landed',
      commonKnowledge: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    // target_table is free text resolved through the runtime registry, so an
    // unregistered name is the cheapest real reverse-replay failure.
    await db.insert(deltas).values({
      id: 'delta_unreversible',
      branchId: 'b1',
      entryId: null,
      actionId: 'act_burst',
      logPosition: 1,
      source: 'ai_classifier',
      targetTable: 'not_a_registered_table',
      targetId: 'hap_1',
      op: 'create',
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    })

    const report = await recoverInFlightRuns(ctx)

    expect(report.reversed).toHaveLength(0)
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]).toMatchObject({ kind: 'periodic-classifier', actionId: 'act_burst' })
    // Left for the next boot to retry rather than settled.
    const [marker] = await db.select().from(pipelineRuns)
    expect(marker.finishedAt).toBeNull()
    // The partial write survived, which is exactly why the branch cannot re-run.
    expect(await db.select().from(happenings)).toHaveLength(1)

    await resetStuckClassifierRunState(
      ctx,
      report.failures.map((f) => f.actionId),
    )

    const [branch] = await db
      .select({ classifierStatus: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.classifierStatus).toEqual(running)
  })
})
