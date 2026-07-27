import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  APP_SETTINGS_DEFAULTS,
  APP_SETTINGS_SINGLETON_ID,
  appSettings,
  buildStorySettings,
  type DbCtx,
  type ProviderInstance,
  type StorySettings,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  currentStoryStore,
  embedderSwapStore,
  rehydrateAppSettings,
  rehydrateStories,
  storiesStore,
} from '@/lib/stores'

import {
  cancelStorySwap,
  makeCallbackGuards,
  RelabelBlockedError,
  relabelStory,
  resolveStorySwapConfig,
  runExclusive,
  startStorySwap,
  SwapBusyError,
} from './app-deps'
import { startSwap } from './engine'

vi.mock('./engine', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, startSwap: vi.fn() }
})

const MINILM = 'Xenova/all-MiniLM-L6-v2'

describe('runExclusive single-flight lock', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a concurrent second call for the same story with SwapBusyError', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = runExclusive('s1', () => gate.then(() => 'first' as const))
    await expect(runExclusive('s1', async () => 'second')).rejects.toBeInstanceOf(SwapBusyError)

    release()
    await expect(first).resolves.toBe('first')
    // Lock released on settle: a fresh call for the same story now succeeds.
    await expect(runExclusive('s1', async () => 'again')).resolves.toBe('again')
  })

  it('allows concurrent calls for different stories', async () => {
    let releaseA: () => void = () => {}
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve
    })

    const a = runExclusive('sA', () => gateA.then(() => 'A' as const))
    await expect(runExclusive('sB', async () => 'B')).resolves.toBe('B')

    releaseA()
    await expect(a).resolves.toBe('A')
  })

  it('releases the lock when the wrapped fn rejects', async () => {
    await expect(
      runExclusive('s1', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(runExclusive('s1', async () => 'ok')).resolves.toBe('ok')
  })
})

describe('callback guards', () => {
  afterEach(() => {
    embedderSwapStore.__reset()
    vi.restoreAllMocks()
  })

  it('a throwing onProgress never propagates out of the guard', () => {
    vi.spyOn(embedderSwapStore, 'setProgress').mockImplementation(() => {
      throw new Error('ui blew up')
    })
    const guards = makeCallbackGuards('s1')
    expect(() => guards.onProgress(1, 4)).not.toThrow()
  })

  it('isCancelRequested reflects the store flag', () => {
    const guards = makeCallbackGuards('s1')
    expect(guards.isCancelRequested()).toBe(false)
    embedderSwapStore.requestCancel()
    expect(guards.isCancelRequested()).toBe(true)
  })

  it('isCancelRequested defaults to false when the store read throws', () => {
    vi.spyOn(embedderSwapStore, 'getState').mockImplementation(() => {
      throw new Error('store gone')
    })
    expect(makeCallbackGuards('s1').isCancelRequested()).toBe(false)
  })
})

describe('stale cancel-flag isolation across operations', () => {
  afterEach(() => {
    storiesStore.__reset()
    currentStoryStore.__reset()
    embedderSwapStore.__reset()
    vi.restoreAllMocks()
  })

  async function seedStory(): Promise<DbCtx> {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const settings = buildStorySettings({}, MINILM, null)
    sqlite
      .prepare(
        'INSERT INTO stories (id, title, settings, created_at, updated_at) VALUES (?,?,?,?,?)',
      )
      .run('s1', 'S', JSON.stringify(settings), 1000, 1000)
    sqlite
      .prepare('INSERT INTO branches (id, story_id, name, created_at) VALUES (?,?,?,?)')
      .run('b1', 's1', 'main', 1000)
    await rehydrateStories(db)
    return { db, runInTransaction }
  }

  it('a cancel with nothing running does not poison the next swap', async () => {
    const ctx = await seedStory()

    // A cancel against a story with no in-flight swap sets the global flag, then
    // must clear it before returning.
    await cancelStorySwap('s1', ctx)
    expect(embedderSwapStore.getState().cancelRequested).toBe(false)

    let firstPoll: boolean | undefined
    vi.mocked(startSwap).mockImplementation(async (deps) => {
      firstPoll = deps.isCancelRequested()
      return 'completed'
    })

    const result = await startStorySwap('s1', { modelId: MINILM, backend: 'local' }, ctx)

    expect(startSwap).toHaveBeenCalledOnce()
    expect(firstPoll).toBe(false)
    expect(result).toBe('completed')
  })
})

const PROVIDER_MODEL = 'text-embedding-3-small'
const TARGET_MODEL = 'text-embedding-3-large'

function cachedProvider(
  id: string,
  models: { id: string; capabilities?: { matryoshkaSupported?: boolean } }[],
): ProviderInstance {
  return {
    id,
    type: 'openai-compatible',
    displayName: id,
    apiKey: 'k',
    endpoint: 'http://localhost:1234/v1',
    favoriteModelIds: [],
    cachedModels: models,
  }
}

async function seedStores(
  settings: StorySettings,
  providers: ProviderInstance[] = [],
): Promise<{ ctx: DbCtx; sqlite: Awaited<ReturnType<typeof createTestDb>>['sqlite'] }> {
  const { db, sqlite, runInTransaction } = await createTestDb()
  await db.insert(appSettings).values({
    id: APP_SETTINGS_SINGLETON_ID,
    ...APP_SETTINGS_DEFAULTS,
    providers,
  })
  await rehydrateAppSettings(db)
  sqlite
    .prepare('INSERT INTO stories (id, title, settings, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run('s1', 'S', JSON.stringify(settings), 1000, 1000)
  await rehydrateStories(db)
  return { ctx: { db, runInTransaction }, sqlite }
}

function settingsOf(
  sqlite: Awaited<ReturnType<typeof createTestDb>>['sqlite'],
): Record<string, unknown> {
  const row = sqlite.prepare('SELECT settings FROM stories WHERE id = ?').get('s1') as {
    settings: string
  }
  return JSON.parse(row.settings) as Record<string, unknown>
}

describe('resolveStorySwapConfig cross-backend targets', () => {
  afterEach(() => {
    storiesStore.__reset()
    currentStoryStore.__reset()
    vi.restoreAllMocks()
  })

  it('resolves a provider target for a local-backend story', async () => {
    await seedStores(buildStorySettings({ embeddingBackend: 'local' }, MINILM, null), [
      cachedProvider('prov1', [{ id: TARGET_MODEL }]),
    ])

    const resolution = resolveStorySwapConfig('s1', {
      modelId: TARGET_MODEL,
      backend: 'provider',
      providerId: 'prov1',
    })

    // Resolving the target against the story's still-local backend is the
    // `unknown-local-model` failure cross-backend targets exist to avoid.
    expect(resolution).toMatchObject({
      ok: true,
      config: { backend: 'provider', providerId: 'prov1', modelId: TARGET_MODEL },
    })
  })

  it('resolves a local target for a provider-backed story', async () => {
    await seedStores(
      buildStorySettings({ embeddingBackend: 'provider' }, PROVIDER_MODEL, 'prov1'),
      [cachedProvider('prov1', [{ id: PROVIDER_MODEL }])],
    )

    const resolution = resolveStorySwapConfig('s1', { modelId: MINILM, backend: 'local' })

    // Keeping the story's provider backend here would resolve a local model id as
    // a provider model: ok at resolve time, a 4xx on the first embed.
    expect(resolution).toMatchObject({
      ok: true,
      config: { backend: 'local', modelId: MINILM, dim: 384 },
    })
  })

  it('reads capabilities from the target provider, not the story provider', async () => {
    await seedStores(
      buildStorySettings({ embeddingBackend: 'provider' }, PROVIDER_MODEL, 'prov1', 256),
      [
        cachedProvider('prov1', [
          { id: PROVIDER_MODEL, capabilities: { matryoshkaSupported: false } },
        ]),
        cachedProvider('prov2', [
          { id: TARGET_MODEL, capabilities: { matryoshkaSupported: true } },
        ]),
      ],
    )

    const resolution = resolveStorySwapConfig('s1', {
      modelId: TARGET_MODEL,
      backend: 'provider',
      providerId: 'prov2',
    })

    // Capabilities looked up under the story's prov1 would miss TARGET_MODEL
    // entirely and silently drop the server-side dimensions request.
    expect(resolution).toMatchObject({
      ok: true,
      config: { providerId: 'prov2', requestDimensions: true, effectiveDim: 256 },
    })
  })

  it('keeps the story locked effectiveDim rather than re-picking it', async () => {
    await seedStores(
      buildStorySettings({ embeddingBackend: 'provider' }, PROVIDER_MODEL, 'prov1', 512),
      [cachedProvider('prov1', [{ id: TARGET_MODEL }])],
    )

    const resolution = resolveStorySwapConfig('s1', {
      modelId: TARGET_MODEL,
      backend: 'provider',
      providerId: 'prov1',
    })

    expect(resolution).toMatchObject({ ok: true, config: { effectiveDim: 512 } })
  })

  it('reports no-model for a story that is not in the store', async () => {
    await seedStores(buildStorySettings({ embeddingBackend: 'local' }, MINILM, null))

    expect(resolveStorySwapConfig('missing', { modelId: MINILM, backend: 'local' })).toEqual({
      ok: false,
      reason: 'no-model',
    })
  })
})

describe('relabelStory', () => {
  afterEach(() => {
    storiesStore.__reset()
    currentStoryStore.__reset()
    vi.restoreAllMocks()
  })

  it('writes model id, backend and provider id as one triple', async () => {
    // Branch-less on purpose: relabelModel's vec identity rewrite is pinned by the
    // engine tests, so this isolates the settings write the app layer owns.
    const { ctx, sqlite } = await seedStores(
      buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
    )

    await relabelStory(
      's1',
      { modelId: PROVIDER_MODEL, backend: 'provider', providerId: 'prov1' },
      ctx,
    )

    expect(settingsOf(sqlite)).toMatchObject({
      embedding_model_id: PROVIDER_MODEL,
      embeddingBackend: 'provider',
      embedding_provider_id: 'prov1',
    })
  })

  it('clears the provider id when relabelling onto a local target', async () => {
    const { ctx, sqlite } = await seedStores(
      buildStorySettings({ embeddingBackend: 'provider' }, PROVIDER_MODEL, 'prov1'),
    )

    await relabelStory('s1', { modelId: MINILM, backend: 'local' }, ctx)

    const settings = settingsOf(sqlite)
    expect(settings).toMatchObject({ embedding_model_id: MINILM, embeddingBackend: 'local' })
    expect(settings.embedding_provider_id).toBeUndefined()
  })

  it('refuses while a swap marker is set', async () => {
    const { ctx } = await seedStores({
      ...buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
      embedding_swap_target: TARGET_MODEL,
    })

    // Relabel's pre-delete targets exactly the rows a swap has staged.
    await expect(
      relabelStory(
        's1',
        { modelId: PROVIDER_MODEL, backend: 'provider', providerId: 'prov1' },
        ctx,
      ),
    ).rejects.toBeInstanceOf(RelabelBlockedError)
  })
})
