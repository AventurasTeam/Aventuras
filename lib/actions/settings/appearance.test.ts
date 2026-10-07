import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { appSettingsStore, rehydrateAppSettings, resetAllStores } from '@/lib/stores'

import { setAppearanceThemeId, setReaderRailCollapsed } from './appearance'

let db: Awaited<ReturnType<typeof createTestDb>>['db']
let runInTransaction: Awaited<ReturnType<typeof createTestDb>>['runInTransaction']

beforeEach(async () => {
  ;({ db, runInTransaction } = await createTestDb())
  await db.insert(appSettings).values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS })
  await rehydrateAppSettings(db)
})
afterEach(() => {
  resetAllStores()
})

async function readAppearance() {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  return rows[0]?.appearance
}

const storedRailCollapsed = () => appSettingsStore.getAppSettings().appearance.readerRailCollapsed

describe('setAppearanceThemeId', () => {
  it('persists the id, preserves sibling appearance keys, and rehydrates the store', async () => {
    await setAppearanceThemeId('tokyo-night', { db, runInTransaction })
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

    await setAppearanceThemeId('tokyo-night', { db, runInTransaction })

    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
    expect(rows[0]?.appearance).toEqual({ ...staleFree, themeId: 'tokyo-night' })
  })
})

describe('setReaderRailCollapsed', () => {
  it('starts open on a first-launch row', () => {
    expect(storedRailCollapsed()).toBe(false)
  })

  it('persists either value, preserves sibling appearance keys, and rehydrates the store', async () => {
    await setReaderRailCollapsed(true, { db, runInTransaction })
    expect(await readAppearance()).toEqual({
      ...APP_SETTINGS_DEFAULTS.appearance,
      readerRailCollapsed: true,
    })
    expect(storedRailCollapsed()).toBe(true)

    await setReaderRailCollapsed(false, { db, runInTransaction })
    expect(await readAppearance()).toEqual({
      ...APP_SETTINGS_DEFAULTS.appearance,
      readerRailCollapsed: false,
    })
    expect(storedRailCollapsed()).toBe(false)
  })

  it('merges off the DB row, not a stale store cache', async () => {
    const stale = { ...APP_SETTINGS_DEFAULTS.appearance, themeId: 'tokyo-night' }
    await db
      .update(appSettings)
      .set({ appearance: stale })
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))

    await setReaderRailCollapsed(true, { db, runInTransaction })

    expect(await readAppearance()).toEqual({ ...stale, readerRailCollapsed: true })
  })

  it('reads a row written before the key existed as open, and adds the key on write', async () => {
    await setReaderRailCollapsed(true, { db, runInTransaction })
    const { readerRailCollapsed: _absent, ...legacy } = APP_SETTINGS_DEFAULTS.appearance
    await db
      .update(appSettings)
      .set({ appearance: legacy as never })
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
    await rehydrateAppSettings(db)
    expect(storedRailCollapsed()).toBe(false)

    await setReaderRailCollapsed(true, { db, runInTransaction })
    expect(await readAppearance()).toEqual({ ...legacy, readerRailCollapsed: true })
  })

  it('propagates a failed write and leaves the store untouched', async () => {
    const failingTransaction = async (): Promise<void> => {
      throw new Error('disk full')
    }

    await expect(
      setReaderRailCollapsed(true, { db, runInTransaction: failingTransaction }),
    ).rejects.toThrow('disk full')

    expect(storedRailCollapsed()).toBe(false)
    expect((await readAppearance())?.readerRailCollapsed).toBe(false)
  })
})
