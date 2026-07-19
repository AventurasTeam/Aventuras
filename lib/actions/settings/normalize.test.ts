import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { normalizeAppSettingsRow } from './normalize'

let db: Awaited<ReturnType<typeof createTestDb>>['db']

beforeEach(async () => {
  ;({ db } = await createTestDb())
})

const readRow = async () => {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  return rows[0]
}

describe('normalizeAppSettingsRow', () => {
  it('materializes schema-added defaults missing from a stored column', async () => {
    await db.insert(appSettings).values({
      id: APP_SETTINGS_SINGLETON_ID,
      ...APP_SETTINGS_DEFAULTS,
      // Pre-showJumpToBottom row shape.
      appearance: {} as never,
    })
    const res = await normalizeAppSettingsRow({ db })
    expect(res).toEqual({ status: 'normalized', columns: ['appearance'] })
    expect((await readRow())?.appearance).toEqual(APP_SETTINGS_DEFAULTS.appearance)
    expect((await readRow())?.appearance.showJumpToBottom).toBe(true)
  })

  it('adds missing defaults add-only — unknown keys and stored values survive', async () => {
    await db.insert(appSettings).values({
      id: APP_SETTINGS_SINGLETON_ID,
      ...APP_SETTINGS_DEFAULTS,
      // Missing themeId/readerFontScale/density; carries a user value and an
      // unknown key from a newer build.
      appearance: { showJumpToBottom: false, unknownKey: 1 } as never,
    })
    const res = await normalizeAppSettingsRow({ db })
    expect(res.status).toBe('normalized')
    expect((await readRow())?.appearance).toEqual({
      ...APP_SETTINGS_DEFAULTS.appearance,
      showJumpToBottom: false,
      unknownKey: 1,
    })
  })

  it('is a noop when a column only carries an unknown key (nothing to add)', async () => {
    await db.insert(appSettings).values({
      id: APP_SETTINGS_SINGLETON_ID,
      ...APP_SETTINGS_DEFAULTS,
      appearance: { ...APP_SETTINGS_DEFAULTS.appearance, unknownKey: 1 } as never,
    })
    const res = await normalizeAppSettingsRow({ db })
    expect(res).toEqual({ status: 'noop' })
    expect((await readRow())?.appearance).toEqual({
      ...APP_SETTINGS_DEFAULTS.appearance,
      unknownKey: 1,
    })
  })

  it('is a noop on an already-canonical row', async () => {
    await db.insert(appSettings).values({
      id: APP_SETTINGS_SINGLETON_ID,
      ...APP_SETTINGS_DEFAULTS,
    })
    await normalizeAppSettingsRow({ db })
    const res = await normalizeAppSettingsRow({ db })
    expect(res).toEqual({ status: 'noop' })
  })

  it('leaves a corrupt row untouched', async () => {
    await db.insert(appSettings).values({
      id: APP_SETTINGS_SINGLETON_ID,
      ...APP_SETTINGS_DEFAULTS,
      providers: 'not-an-array' as never,
    })
    const before = await readRow()
    const res = await normalizeAppSettingsRow({ db })
    expect(res).toEqual({ status: 'skipped-corrupt' })
    expect(await readRow()).toEqual(before)
  })

  it('skips a bad diagnostics column while still normalizing config columns', async () => {
    await db.insert(appSettings).values({
      id: APP_SETTINGS_SINGLETON_ID,
      ...APP_SETTINGS_DEFAULTS,
      appearance: {} as never,
      diagnostics: { enabled: 'garbage' } as never,
    })
    const res = await normalizeAppSettingsRow({ db })
    expect(res).toEqual({ status: 'normalized', columns: ['appearance'] })
    // Bad diagnostics stays inspectable, not clobbered with defaults.
    expect((await readRow())?.diagnostics).toEqual({ enabled: 'garbage' })
  })

  it('returns no-row when the singleton is absent', async () => {
    expect(await normalizeAppSettingsRow({ db })).toEqual({ status: 'no-row' })
  })

  it('never materializes defaultStorySettings — absent keys keep tracking defaults', async () => {
    await db.insert(appSettings).values({
      id: APP_SETTINGS_SINGLETON_ID,
      ...APP_SETTINGS_DEFAULTS,
    })
    await normalizeAppSettingsRow({ db })
    expect((await readRow())?.defaultStorySettings).toEqual(
      APP_SETTINGS_DEFAULTS.defaultStorySettings,
    )
  })
})
