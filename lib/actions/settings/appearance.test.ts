import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { appSettingsStore, rehydrateAppSettings, resetAllStores } from '@/lib/stores'

import { setAppearanceThemeId } from './appearance'

let db: Awaited<ReturnType<typeof createTestDb>>['db']

beforeEach(async () => {
  ;({ db } = await createTestDb())
  await db.insert(appSettings).values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS })
  await rehydrateAppSettings(db)
})
afterEach(() => {
  resetAllStores()
})

describe('setAppearanceThemeId', () => {
  it('persists the id, preserves sibling appearance keys, and rehydrates the store', async () => {
    await setAppearanceThemeId('tokyo-night', { db })
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
    expect(rows[0]?.appearance).toEqual({
      ...APP_SETTINGS_DEFAULTS.appearance,
      themeId: 'tokyo-night',
    })
    expect(appSettingsStore.getAppSettings().appearance.themeId).toBe('tokyo-night')
  })
})
