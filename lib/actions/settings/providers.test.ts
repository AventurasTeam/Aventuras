import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveModel } from '@/lib/ai'
import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_SINGLETON_ID, appSettings } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { redactHeaderValue, setHttpCallKnownSecretValues } from '@/lib/diagnostics'
import { appSettingsStore, rehydrateAppSettings, resetAllStores } from '@/lib/stores'

import { addProvider, quickWireModel } from './providers'

let db: Awaited<ReturnType<typeof createTestDb>>['db']

beforeEach(async () => {
  ;({ db } = await createTestDb())
  await db.insert(appSettings).values({ id: APP_SETTINGS_SINGLETON_ID, ...APP_SETTINGS_DEFAULTS })
  await rehydrateAppSettings(db)
})
afterEach(() => {
  resetAllStores()
  setHttpCallKnownSecretValues([])
})

const oaiProvider = {
  id: 'prov-1',
  type: 'openai-compatible' as const,
  displayName: 'Local',
  apiKey: 'k',
  endpoint: 'http://x/v1',
  favoriteModelIds: [],
}

describe('provider mutators', () => {
  it('addProvider persists and rehydrates the store', async () => {
    await addProvider(oaiProvider, { db })
    const cfg = appSettingsStore.getAppSettings()
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.providers[0].id).toBe('prov-1')
  })

  it('quickWireModel wires narrative + one agent profile + all six assignments + default', async () => {
    await addProvider(oaiProvider, { db })
    await quickWireModel({ providerId: 'prov-1', modelId: 'm-1' }, { db })

    const cfg = appSettingsStore.getAppSettings()
    expect(cfg.defaultProviderId).toBe('prov-1')
    expect(cfg.profiles.filter((p) => p.kind === 'narrative')).toHaveLength(1)
    expect(cfg.profiles.filter((p) => p.kind === 'agent')).toHaveLength(1)
    expect(Object.keys(cfg.assignments).sort()).toEqual(
      ['classifier', 'lore-mgmt', 'retrieval', 'suggestion', 'translation', 'wizard-assist'].sort(),
    )

    const config = {
      providers: cfg.providers,
      profiles: cfg.profiles,
      assignments: cfg.assignments,
      defaultProviderId: cfg.defaultProviderId,
    }
    expect(resolveModel('narrative', config)).toMatchObject({ ok: true, modelId: 'm-1' })
    expect(resolveModel('wizard-assist', config)).toMatchObject({ ok: true, modelId: 'm-1' })
  })

  it('registers the configured provider key for httpCallSink redaction', async () => {
    await addProvider({ ...oaiProvider, apiKey: 'sk-secret-xyz' }, { db })
    expect(redactHeaderValue('Bearer sk-secret-xyz')).toBe('***')
  })

  it('rejects an invalid provider shape at the boundary', async () => {
    const bad = { id: 'x', type: 'nope', displayName: 'X', apiKey: 'k', favoriteModelIds: [] }
    // @ts-expect-error invalid provider type — rejected by Zod at the write boundary
    await expect(addProvider(bad, { db })).rejects.toThrow()
  })
})
