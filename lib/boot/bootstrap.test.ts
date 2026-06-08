import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { __resetRegistrationGuard, __resetRegistry } from '@/lib/actions'
import {
  APP_SETTINGS_DEFAULTS,
  APP_SETTINGS_SINGLETON_ID,
  appSettings,
  branches,
  deltas,
  pipelineRuns,
  stories,
  storyEntries,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { __resetDiagnosticsGate } from '@/lib/diagnostics'
import { appSettingsStore, resetAllStores } from '@/lib/stores'

import { runBootstrap } from './bootstrap'

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
  })

  it('recovery failure does not block boot (still hydrates)', async () => {
    await seedRow()
    ctx.sqlite.exec('DROP TABLE pipeline_runs')
    const r = await runBootstrap(ctx)
    expect(r).toEqual({ status: 'ok' })
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
    await ctx.db
      .insert(storyEntries)
      .values({
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
  })
})
