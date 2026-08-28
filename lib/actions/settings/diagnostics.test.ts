import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  __resetDiagnosticsGate,
  clearBuffers,
  configureDiagnosticsGate,
  getDiagnosticsSnapshot,
  logger,
} from '@/lib/diagnostics'
import { appSettingsStore, rehydrateAppSettings, resetAllStores } from '@/lib/stores'

import { setDebugLevelEnabled, setDiagnosticsEnabled } from './diagnostics'
import { resetAppSettings } from './reset'

let db: Awaited<ReturnType<typeof createTestDb>>['db']
let runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']

beforeEach(async () => {
  ;({ db, runInTransaction } = await createTestDb())
  await db.insert(appSettings).values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS })
  await rehydrateAppSettings(db)
  __resetDiagnosticsGate()
  clearBuffers()
})
afterEach(() => {
  resetAllStores()
  clearBuffers()
  __resetDiagnosticsGate()
})

const readDiagnostics = async () => {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  return rows[0]?.diagnostics
}

describe('diagnostics toggle actions', () => {
  it('setDiagnosticsEnabled persists, re-hydrates, and the store reflects it', async () => {
    await setDiagnosticsEnabled(true, { db, runInTransaction })
    expect(await readDiagnostics()).toEqual({ enabled: true, debug_level_enabled: false })
    expect(appSettingsStore.getAppSettings().diagnostics.enabled).toBe(true)
  })

  it('setDebugLevelEnabled preserves enabled', async () => {
    await setDiagnosticsEnabled(true, { db, runInTransaction })
    await setDebugLevelEnabled(true, { db, runInTransaction })
    expect(await readDiagnostics()).toEqual({ enabled: true, debug_level_enabled: true })
  })

  it('master on-write does NOT clear the in-memory buffers', async () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    logger.warn('pipeline.run_aborted')
    expect(getDiagnosticsSnapshot().logEntries.length).toBeGreaterThan(0)
    await setDiagnosticsEnabled(true, { db, runInTransaction })
    expect(getDiagnosticsSnapshot().logEntries.length).toBeGreaterThan(0)
  })

  it('master off-write clears the in-memory buffers', async () => {
    configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    logger.warn('pipeline.run_aborted')
    expect(getDiagnosticsSnapshot().logEntries.length).toBeGreaterThan(0)
    await setDiagnosticsEnabled(false, { db, runInTransaction })
    expect(getDiagnosticsSnapshot().logEntries).toEqual([])
  })

  it('toggling twice is reflected live in the store (not a captured snapshot)', async () => {
    await setDiagnosticsEnabled(true, { db, runInTransaction })
    expect(appSettingsStore.getAppSettings().diagnostics.enabled).toBe(true)
    await setDiagnosticsEnabled(false, { db, runInTransaction })
    expect(appSettingsStore.getAppSettings().diagnostics.enabled).toBe(false)
  })

  it('resetAppSettings writes defaults and re-hydrates ok', async () => {
    await db
      .update(appSettings)
      .set({ defaultProviderId: 'p9' })
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
    const r = await resetAppSettings({ db, runInTransaction })
    expect(r).toEqual({ status: 'ok' })
    expect(appSettingsStore.getAppSettings().defaultProviderId).toBeNull()
  })
})
