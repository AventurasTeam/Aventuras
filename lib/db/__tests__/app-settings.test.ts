import { describe, expect, it } from 'vitest'

import { ensureAppSettingsSingleton } from '../app-settings/app-settings-defaults'
import { appSettings } from '../schema'
import { createTestDb } from './test-db'

describe('ensureAppSettingsSingleton', () => {
  it('creates the singleton with diagnostics flags false', async () => {
    const { db } = await createTestDb()
    await ensureAppSettingsSingleton(db)
    const rows = await db.select().from(appSettings)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('singleton')
    expect(rows[0].diagnostics).toEqual({ enabled: false, debug_level_enabled: false })
  })

  it('is idempotent (second call does not duplicate or reset)', async () => {
    const { db } = await createTestDb()
    await ensureAppSettingsSingleton(db)
    await ensureAppSettingsSingleton(db)
    const rows = await db.select().from(appSettings)
    expect(rows).toHaveLength(1)
  })
})
