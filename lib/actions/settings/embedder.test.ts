import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { appSettingsStore, rehydrateAppSettings, resetAllStores } from '@/lib/stores'

import {
  ensureProviderEmbeddingDim,
  probeProviderEmbeddingDim,
  setEmbedderDefaults,
} from './embedder'
import { addProvider } from './providers'

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

describe('setEmbedderDefaults', () => {
  it('persists model id, provider id, and backend in one write', async () => {
    await setEmbedderDefaults(
      { backend: 'provider', modelId: 'text-embedding-3-small', providerId: 'prov-1' },
      { db, runInTransaction },
    )

    const cfg = appSettingsStore.getAppSettings()
    expect(cfg.embeddingModelId).toBe('text-embedding-3-small')
    expect(cfg.embeddingProviderId).toBe('prov-1')
    expect(cfg.defaultStorySettings.embeddingBackend).toBe('provider')
  })

  it('local backend nulls providerId even if input.providerId is set', async () => {
    await setEmbedderDefaults(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', providerId: 'prov-1' },
      { db, runInTransaction },
    )

    const cfg = appSettingsStore.getAppSettings()
    expect(cfg.embeddingModelId).toBe('Xenova/all-MiniLM-L6-v2')
    expect(cfg.embeddingProviderId).toBeNull()
    expect(cfg.defaultStorySettings.embeddingBackend).toBe('local')
  })

  it('switching backend local -> provider -> local nulls providerId appropriately', async () => {
    await setEmbedderDefaults(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', providerId: null },
      { db, runInTransaction },
    )
    expect(appSettingsStore.getAppSettings().embeddingProviderId).toBeNull()

    await setEmbedderDefaults(
      { backend: 'provider', modelId: 'text-embedding-3-small', providerId: 'prov-1' },
      { db, runInTransaction },
    )
    expect(appSettingsStore.getAppSettings().embeddingProviderId).toBe('prov-1')
    expect(appSettingsStore.getAppSettings().defaultStorySettings.embeddingBackend).toBe('provider')

    await setEmbedderDefaults(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', providerId: null },
      { db, runInTransaction },
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
      { db, runInTransaction },
    )

    const cfg = appSettingsStore.getAppSettings()
    expect(cfg.defaultStorySettings.activePackId).toBe('some-pack')
    expect(cfg.defaultStorySettings.embeddingBackend).toBe('provider')
  })

  it('rehydrates the store snapshot after the write', async () => {
    expect(appSettingsStore.getAppSettings().embeddingModelId).toBeNull()

    await setEmbedderDefaults(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', providerId: null },
      { db, runInTransaction },
    )

    expect(appSettingsStore.getAppSettings().embeddingModelId).toBe('Xenova/all-MiniLM-L6-v2')
  })
})

describe('provider embedding dimension probes', () => {
  const provider = {
    id: 'prov-1',
    type: 'openai-compatible' as const,
    displayName: 'Provider',
    apiKey: 'k',
    endpoint: 'http://localhost:1234/v1',
    favoriteModelIds: [],
    cachedModels: [{ id: 'embed-1', capabilities: { embedding: true } }],
  }

  it('persists the native dimension returned by a successful probe', async () => {
    await addProvider(provider, { db, runInTransaction })
    const runTest = vi.fn(async () => ({ ok: true as const, dim: 1536, ms: 12 }))

    await expect(
      probeProviderEmbeddingDim(
        { providerId: 'prov-1', modelId: 'embed-1' },
        { db, runInTransaction },
        runTest,
      ),
    ).resolves.toEqual({ ok: true, dim: 1536, ms: 12 })

    expect(runTest).toHaveBeenCalledWith(
      {
        backend: 'provider',
        providerId: 'prov-1',
        modelId: 'embed-1',
        dim: null,
        truncation: null,
      },
      expect.objectContaining({ id: 'prov-1' }),
    )
    expect(
      appSettingsStore
        .getAppSettings()
        .providers[0].cachedModels?.find((model) => model.id === 'embed-1')?.capabilities,
    ).toMatchObject({ embedding: true, embeddingDim: 1536 })
  })

  it('uses a cached native dimension without probing again', async () => {
    await addProvider(
      {
        ...provider,
        cachedModels: [
          {
            id: 'embed-1',
            capabilities: { embedding: true, embeddingDim: 768 },
          },
        ],
      },
      { db, runInTransaction },
    )
    const runTest = vi.fn()

    await expect(
      ensureProviderEmbeddingDim(
        { providerId: 'prov-1', modelId: 'embed-1' },
        { db, runInTransaction },
        runTest,
      ),
    ).resolves.toMatchObject({ ok: true, dim: 768 })
    expect(runTest).not.toHaveBeenCalled()
  })
})
