import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { appSettingsStore, rehydrateAppSettings, resetAllStores } from '@/lib/stores'

import { setEmbedderDefaults } from './embedder'

let db: Awaited<ReturnType<typeof createTestDb>>['db']

beforeEach(async () => {
  ;({ db } = await createTestDb())
  await db.insert(appSettings).values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS })
  await rehydrateAppSettings(db)
})
afterEach(() => {
  resetAllStores()
})

describe('setEmbedderDefaults', () => {
  it('persists model id, provider id, and backend in one write', async () => {
    await setEmbedderDefaults(
      { backend: 'provider', modelId: 'text-embedding-3-small', providerId: 'prov-1' },
      { db },
    )

    const cfg = appSettingsStore.getAppSettings()
    expect(cfg.embeddingModelId).toBe('text-embedding-3-small')
    expect(cfg.embeddingProviderId).toBe('prov-1')
    expect(cfg.defaultStorySettings.embeddingBackend).toBe('provider')
  })

  it('local backend nulls providerId even if input.providerId is set', async () => {
    await setEmbedderDefaults(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', providerId: 'prov-1' },
      { db },
    )

    const cfg = appSettingsStore.getAppSettings()
    expect(cfg.embeddingModelId).toBe('Xenova/all-MiniLM-L6-v2')
    expect(cfg.embeddingProviderId).toBeNull()
    expect(cfg.defaultStorySettings.embeddingBackend).toBe('local')
  })

  it('switching backend local -> provider -> local nulls providerId appropriately', async () => {
    await setEmbedderDefaults(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', providerId: null },
      { db },
    )
    expect(appSettingsStore.getAppSettings().embeddingProviderId).toBeNull()

    await setEmbedderDefaults(
      { backend: 'provider', modelId: 'text-embedding-3-small', providerId: 'prov-1' },
      { db },
    )
    expect(appSettingsStore.getAppSettings().embeddingProviderId).toBe('prov-1')
    expect(appSettingsStore.getAppSettings().defaultStorySettings.embeddingBackend).toBe('provider')

    await setEmbedderDefaults(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', providerId: null },
      { db },
    )
    const cfg = appSettingsStore.getAppSettings()
    expect(cfg.embeddingProviderId).toBeNull()
    expect(cfg.embeddingModelId).toBe('Xenova/all-MiniLM-L6-v2')
    expect(cfg.defaultStorySettings.embeddingBackend).toBe('local')
  })

  it('merges embeddingBackend into existing defaultStorySettings without dropping sibling keys', async () => {
    await db
      .update(appSettings)
      .set({ defaultStorySettings: { activePackId: 'some-pack' } })
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
    await rehydrateAppSettings(db)

    await setEmbedderDefaults(
      { backend: 'provider', modelId: 'text-embedding-3-small', providerId: 'prov-1' },
      { db },
    )

    const cfg = appSettingsStore.getAppSettings()
    expect(cfg.defaultStorySettings.activePackId).toBe('some-pack')
    expect(cfg.defaultStorySettings.embeddingBackend).toBe('provider')
  })

  it('rehydrates the store snapshot after the write', async () => {
    expect(appSettingsStore.getAppSettings().embeddingModelId).toBeNull()

    await setEmbedderDefaults(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', providerId: null },
      { db },
    )

    expect(appSettingsStore.getAppSettings().embeddingModelId).toBe('Xenova/all-MiniLM-L6-v2')
  })
})
