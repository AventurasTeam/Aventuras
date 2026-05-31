import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  APP_SETTINGS_DEFAULTS,
  APP_SETTINGS_SINGLETON_ID,
  appSettings,
  pipelineRuns,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { __resetDiagnosticsGate } from '@/lib/diagnostics'
import { domain } from '@/lib/stores'

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
afterEach(() => domain.__reset())

const seedRow = (overrides: Record<string, unknown> = {}) =>
  ctx.db
    .insert(appSettings)
    .values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS, ...overrides })

describe('runBootstrap', () => {
  it('happy path → ok and the store hydrates', async () => {
    await seedRow({ defaultProviderId: 'p1' })
    const r = await runBootstrap(ctx)
    expect(r).toEqual({ status: 'ok' })
    expect(domain.getAppSettings().defaultProviderId).toBe('p1')
  })

  it('absent row → ok with defaults', async () => {
    const r = await runBootstrap(ctx)
    expect(r).toEqual({ status: 'ok' })
    expect(domain.getAppSettings().diagnostics.enabled).toBe(false)
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
    expect(domain.getAppSettings().diagnostics.enabled).toBe(false)
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
})
