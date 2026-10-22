import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRegistrationGuard, __resetRegistry } from '@/lib/actions'
import {
  __resetBranchWriteLocks,
  withBranchWriteShared,
} from '@/lib/actions/delta/branch-write-lock'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import {
  APP_SETTINGS_DEFAULTS,
  APP_SETTINGS_SINGLETON_ID,
  appSettings,
  branches,
  deltas,
  happenings,
  pipelineRuns,
  stories,
  storyEntries,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { __resetDiagnosticsGate } from '@/lib/diagnostics'
import { embedClassifierDescriptions } from '@/lib/embedder-swap'
import { __resetRegistry as __resetPipelineRegistry, getPipeline } from '@/lib/pipeline'
import {
  __resetClassifierEmbedder,
  classifierEmbedder,
} from '@/lib/pipeline/definitions/description-embedder'
import {
  __resetDeltaActionPort,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '@/lib/pipeline/runtime/action-port'
import { appSettingsStore, recoveryReportStore, resetAllStores } from '@/lib/stores'

import { ensureDeltaActionPort, runBootstrap } from './bootstrap'

let ctx: {
  db: Awaited<ReturnType<typeof createTestDb>>['db']
  runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']
  sqlite: Awaited<ReturnType<typeof createTestDb>>['sqlite']
}

beforeEach(async () => {
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction, sqlite: t.sqlite }
  __resetDiagnosticsGate()
})
afterEach(() => resetAllStores())

const seedRow = (overrides: Record<string, unknown> = {}) =>
  ctx.db
    .insert(appSettings)
    .values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS, ...overrides })

describe('runBootstrap', () => {
  it('happy path → ok and the store hydrates', async () => {
    await seedRow({ defaultProviderId: 'p1' })
    const r = await runBootstrap(ctx)
    expect(r).toEqual({ status: 'ok' })
    expect(appSettingsStore.getAppSettings().defaultProviderId).toBe('p1')
  })

  it('absent row → ok with defaults', async () => {
    const r = await runBootstrap(ctx)
    expect(r).toEqual({ status: 'ok' })
    expect(appSettingsStore.getAppSettings().diagnostics.enabled).toBe(false)
  })

  it('config-corrupt row → config-corrupt', async () => {
    await seedRow({ providers: 'not-an-array' as unknown as [] })
    const r = await runBootstrap(ctx)
    expect(r.status).toBe('config-corrupt')
  })

  it('diagnostics-only corruption → ok, toggles default off', async () => {
    await seedRow({
      diagnostics: { enabled: 'yes' } as unknown as typeof APP_SETTINGS_DEFAULTS.diagnostics,
    })
    const r = await runBootstrap(ctx)
    expect(r).toEqual({ status: 'ok' })
    expect(appSettingsStore.getAppSettings().diagnostics.enabled).toBe(false)
  })

  it('runs crash recovery during bootstrap (clean orphan deleted)', async () => {
    await seedRow()
    await ctx.db.insert(pipelineRuns).values({
      runId: 'r1',
      kind: 'smoke',
      actionId: 'a1',
      storyId: null,
      startedAt: 1,
      finishedAt: null,
      outcome: null,
    })
    await runBootstrap(ctx)
    const rows = await ctx.db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, 'r1'))
    expect(rows).toHaveLength(0)
    expect(recoveryReportStore.getSnapshot().pendingRecoveryReport).toBeNull()
  })

  it('recovery failure does not block boot (still hydrates)', async () => {
    await seedRow()
    ctx.sqlite.exec('DROP TABLE pipeline_runs')
    const r = await runBootstrap(ctx)
    expect(r).toEqual({ status: 'ok' })
    expect(recoveryReportStore.getSnapshot().pendingRecoveryReport).toBeNull()
  })

  it('a per-orphan reversal failure does not block boot, and is reported', async () => {
    await seedRow()
    await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await ctx.db.insert(pipelineRuns).values({
      runId: 'r-failed',
      kind: 'per-turn',
      actionId: 'a-failed',
      storyId: 's1',
      startedAt: 1,
      finishedAt: null,
      outcome: null,
    })
    await ctx.db.insert(deltas).values({
      id: 'd-failed',
      branchId: 'b1',
      entryId: null,
      actionId: 'a-failed',
      logPosition: 1,
      source: 'ai_classifier',
      targetTable: 'not_registered' as never,
      targetId: 'missing',
      op: 'create',
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    })

    const r = await runBootstrap(ctx)

    expect(r).toEqual({ status: 'ok' })
    // The orphan's writes are still on disk, so the user is told rather than left
    // with a silently degraded story.
    const published = recoveryReportStore.getSnapshot().pendingRecoveryReport
    expect(published?.reversed).toEqual([])
    expect(published?.failures).toMatchObject([{ runId: 'r-failed', storyId: 's1' }])
  })

  // Guards the load-bearing registerAllDomains()-before-recovery order. Simulate a
  // cold boot (empty registry): runBootstrap's own registration must repopulate it
  // before reverse-replay, else recovery throws unknown target_table and the dirty
  // orphan's create-delta never reverses. A reorder of those two lines fails here.
  it('registers domains before recovery so a dirty orphan reverses from a cold registry', async () => {
    __resetRegistry()
    __resetRegistrationGuard()

    await seedRow()
    await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await ctx.db.insert(storyEntries).values({
      id: 'e1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'x',
      createdAt: 1,
    })
    await ctx.db.insert(pipelineRuns).values({
      runId: 'r1',
      kind: 'smoke',
      actionId: 'act1',
      storyId: 's1',
      startedAt: 1,
      finishedAt: null,
      outcome: null,
    })
    await ctx.db.insert(deltas).values({
      id: 'd1',
      branchId: 'b1',
      entryId: 'e1',
      actionId: 'act1',
      logPosition: 1,
      source: 'ai_classifier',
      targetTable: 'story_entries',
      targetId: 'e1',
      op: 'create',
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    })

    await runBootstrap(ctx)

    expect((await ctx.db.select().from(storyEntries).where(eq(storyEntries.id, 'e1'))).length).toBe(
      0,
    )
    const [run] = await ctx.db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, 'r1'))
    expect(run.outcome).toBe('recovered')
    expect(recoveryReportStore.getSnapshot().pendingRecoveryReport?.reversed).toMatchObject([
      { runId: 'r1', storyId: 's1', deltas: 1 },
    ])
  })

  it('wires the classifier embedder and registers the pass, which per-turn chains to', async () => {
    __resetClassifierEmbedder()
    __resetPipelineRegistry()
    await seedRow()

    await runBootstrap(ctx)

    expect(classifierEmbedder()).toBe(embedClassifierDescriptions)
    expect(getPipeline(PERIODIC_CLASSIFIER_KIND).kind).toBe(PERIODIC_CLASSIFIER_KIND)
  })

  it('reverses an orphaned pass at boot and hands its branch back to the cadence', async () => {
    await seedRow()
    await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert(branches).values({
      id: 'b1',
      storyId: 's1',
      name: 'm',
      createdAt: 1,
      classifierStatus: {
        state: 'running',
        lastSuccessAt: null,
        lastError: null,
        processedThrough: 2,
      },
    })
    await ctx.db.insert(happenings).values({
      id: 'hap_orphan',
      branchId: 'b1',
      title: 'landed before the crash',
      commonKnowledge: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert(pipelineRuns).values({
      runId: 'r_pass',
      kind: PERIODIC_CLASSIFIER_KIND,
      actionId: 'act_pass',
      storyId: 's1',
      startedAt: 1,
      finishedAt: null,
      outcome: null,
    })
    await ctx.db.insert(deltas).values({
      id: 'd_pass',
      branchId: 'b1',
      entryId: null,
      actionId: 'act_pass',
      logPosition: 1,
      source: 'periodic_classifier',
      targetTable: 'happenings',
      targetId: 'hap_orphan',
      op: 'create',
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    })

    expect(await runBootstrap(ctx)).toEqual({ status: 'ok' })

    expect(await ctx.db.select().from(happenings)).toEqual([])
    const [marker] = await ctx.db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.runId, 'r_pass'))
    expect(marker.outcome).toBe('recovered')
    const [branch] = await ctx.db
      .select({ status: branches.classifierStatus })
      .from(branches)
      .where(eq(branches.id, 'b1'))
    expect(branch.status).toMatchObject({ state: 'idle', processedThrough: 2 })
  })
})

// Every pipeline test configures its own port, so only this pins the production wiring.
describe('ensureDeltaActionPort', () => {
  // The lock advances over microtasks; a macrotask hop runs every queued continuation.
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    __resetDeltaActionPort()
    __resetBranchWriteLocks()
  })
  afterEach(() => {
    __resetDeltaActionPort()
    __resetBranchWriteLocks()
  })

  it("wires the lock's exclusive hold: a shared write waits until it is released", async () => {
    ensureDeltaActionPort()
    await holdBranchWriteExclusive('b1', 'act_run')
    const run = vi.fn(async () => {})
    const write = withBranchWriteShared('b1', 'act_user', run)
    await flush()
    expect(run).not.toHaveBeenCalled()

    releaseBranchWriteExclusive('b1', 'act_run')
    await flush()
    // Checked before awaiting, so a release that frees nothing fails here, not by timeout.
    expect(run).toHaveBeenCalledOnce()
    await write
  })
})
