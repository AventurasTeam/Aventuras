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

  it('merges off the DB row, not a stale store cache', async () => {
    // Mutate a sibling appearance key directly in the DB without rehydrating —
    // the store is now stale. A store-based read-modify-write would revert it.
    const staleFree = { ...APP_SETTINGS_DEFAULTS.appearance, showJumpToBottom: false }
    await db
      .update(appSettings)
      .set({ appearance: staleFree })
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))

    await setAppearanceThemeId('tokyo-night', { db })

    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
    expect(rows[0]?.appearance).toEqual({ ...staleFree, themeId: 'tokyo-night' })
  })
})
