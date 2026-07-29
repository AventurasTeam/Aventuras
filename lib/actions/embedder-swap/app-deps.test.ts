import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  APP_SETTINGS_DEFAULTS,
  APP_SETTINGS_SINGLETON_ID,
  appSettings,
  buildStorySettings,
  setSwapTargetOp,
  storyDefinitionSchema,
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
  reindexStoryNow,
  RelabelBlockedError,
  relabelStory,
  resolveDrainConfig,
  resolveStorySwapConfig,
  resumeStorySwap,
  runExclusive,
  startStorySwap,
  SwapBusyError,
} from './app-deps'
import {
  cancelSwap,
  reindexStory,
  resumeSwap,
  startSwap,
  SwapNotInProgressError,
  type SwapParams,
} from './engine'

vi.mock('./engine', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    startSwap: vi.fn(),
    resumeSwap: vi.fn(),
    reindexStory: vi.fn(),
    // Defaults to the real unwind so marker-clearing assertions keep working;
    // tests that only need the resolved call args override it for one call.
    cancelSwap: vi.fn(actual.cancelSwap as typeof cancelSwap),
  }
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

  it('isCancelRequested reflects the flag on the running swap', () => {
    const guards = makeCallbackGuards('s1')
    expect(guards.isCancelRequested()).toBe(false)
    // A cancel only exists against a live run, so the guard reads false until
    // one is open — there is no slot for a flag to sit in beforehand.
    embedderSwapStore.requestCancel('s1')
    expect(guards.isCancelRequested()).toBe(false)

    embedderSwapStore.beginProgress('s1')
    embedderSwapStore.requestCancel('s1')
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

    // A cancel against a story with no in-flight swap must not leave a flag the
    // next swap's first batch poll would read.
    await cancelStorySwap('s1', ctx)
    expect(embedderSwapStore.isCancelRequested('s1')).toBe(false)

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
  models: {
    id: string
    capabilities?: { matryoshkaSupported?: boolean; embeddingDim?: number }
  }[],
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
      config: { providerId: 'prov2', truncation: { effectiveDim: 256, serverSide: true } },
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

    expect(resolution).toMatchObject({
      ok: true,
      config: { truncation: { effectiveDim: 512, serverSide: false } },
    })
  })

  it('threads the probed provider native dimension into the resolved target config', async () => {
    await seedStores(
      buildStorySettings({ embeddingBackend: 'provider' }, PROVIDER_MODEL, 'prov1', 2048),
      [
        cachedProvider('prov1', [
          {
            id: TARGET_MODEL,
            capabilities: { embeddingDim: 1536, matryoshkaSupported: false },
          },
        ]),
      ],
    )

    const resolution = resolveStorySwapConfig('s1', {
      modelId: TARGET_MODEL,
      backend: 'provider',
      providerId: 'prov1',
    })

    expect(resolution).toMatchObject({
      ok: true,
      config: {
        dim: 1536,
        truncation: { effectiveDim: 2048, serverSide: false },
      },
    })
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

  it('relabels onto a model the catalog has never heard of', async () => {
    const { ctx, sqlite } = await seedStores(
      buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
    )

    // A renamed local copy resolves no catalog entry. Relabel is the one path that
    // may name such a model, so an unresolvable target must not become a refusal —
    // it just leaves the dim guard with nothing to compare.
    await relabelStory('s1', { modelId: 'e2e/minilm-copy', backend: 'local' }, ctx)

    expect(settingsOf(sqlite)).toMatchObject({ embedding_model_id: 'e2e/minilm-copy' })
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

describe('store refresh on every engine exit', () => {
  afterEach(() => {
    storiesStore.__reset()
    currentStoryStore.__reset()
    embedderSwapStore.__reset()
    vi.restoreAllMocks()
  })

  it('publishes a marker committed by a swap that then failed', async () => {
    const { ctx } = await seedStores(
      buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
    )

    vi.mocked(startSwap).mockImplementation(async () => {
      // The engine commits the marker in its own transaction before phase 1, so
      // a phase-1 failure leaves it behind.
      await ctx.runInTransaction([
        setSwapTargetOp('s1', { modelId: MINILM, backend: 'local' }, 2000),
      ])
      throw new Error('phase 1 blew up')
    })

    await expect(startStorySwap('s1', { modelId: MINILM, backend: 'local' }, ctx)).rejects.toThrow(
      'phase 1 blew up',
    )

    // Refreshing only on success leaves the panel offering a swap the DB says is
    // already pending: both buttons enabled, no Resume, every retry throwing.
    const settings = storiesStore.getStories().rows.find((row) => row.id === 's1')?.settings
    expect(settings?.embedding_swap_target).toBe(MINILM)
  })
})

describe('cancelStorySwap outcome', () => {
  afterEach(() => {
    storiesStore.__reset()
    currentStoryStore.__reset()
    embedderSwapStore.__reset()
    vi.restoreAllMocks()
  })

  it('reports nothing-pending when no swap is in flight and no marker is set', async () => {
    const { ctx } = await seedStores(
      buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
    )

    await expect(cancelStorySwap('s1', ctx)).resolves.toBe('nothing-pending')
  })

  it('reports already-completed when the run finished past its last cancel poll', async () => {
    const { ctx } = await seedStores(
      buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
    )
    vi.mocked(startSwap).mockResolvedValue('completed')

    // Cancel races a run that completes: awaiting it returns, but nothing was
    // unwound and the model changed. Reporting void here read as success.
    const run = startStorySwap('s1', { modelId: MINILM, backend: 'local' }, ctx)
    const outcome = await cancelStorySwap('s1', ctx)
    await run

    expect(outcome).toBe('already-completed')
  })

  it('falls through to a direct unwind when the run rejected before its poll', async () => {
    const { ctx } = await seedStores(
      buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
    )
    vi.mocked(startSwap).mockImplementation(async () => {
      // The engine commits the marker before phase 1, so a throw here leaves it.
      await ctx.runInTransaction([
        setSwapTargetOp('s1', { modelId: MINILM, backend: 'local' }, 2000),
      ])
      throw new Error('provider down')
    })

    const run = startStorySwap('s1', { modelId: MINILM, backend: 'local' }, ctx).catch(() => {})
    const outcome = await cancelStorySwap('s1', ctx)
    await run

    // Swallowing the rejection and returning would have left this marker set
    // while telling the user the cancel worked.
    expect(outcome).toBe('cancelled')
    const settings = storiesStore.getStories().rows.find((row) => row.id === 's1')?.settings
    expect(settings?.embedding_swap_target).toBeUndefined()
  })
})

describe('resolveDrainConfig swap guards', () => {
  const definition = storyDefinitionSchema.parse({
    mode: 'adventure',
    leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
    narration: 'first',
    genre: { label: 'Fantasy', promptBody: 'high fantasy' },
    tone: { label: 'Wry', promptBody: 'wry' },
    setting: 'A keep on a hill.',
    calendarSystemId: 'gregorian',
    worldTimeOrigin: { year: 0 },
  })

  afterEach(() => {
    storiesStore.__reset()
    currentStoryStore.__reset()
    vi.restoreAllMocks()
  })

  it('refuses to drain while an embedder op holds the story lock', async () => {
    const settings = buildStorySettings({ embeddingBackend: 'local' }, MINILM, null)
    await seedStores(settings)
    currentStoryStore.set({ storyId: 's1', branchId: 'b1', definition, settings })
    expect(resolveDrainConfig('s1').ok).toBe(true)

    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const held = runExclusive('s1', () => gate)

    // The open-story snapshot cannot see the swap: the marker reaches this store
    // only after the engine settles, which is exactly when it stops mattering.
    expect(currentStoryStore.getCurrentStory()?.settings.embedding_swap_target).toBeUndefined()
    expect(resolveDrainConfig('s1')).toEqual({ ok: false, reason: 'no-model' })

    release()
    await held
    expect(resolveDrainConfig('s1').ok).toBe(true)
  })

  it('still refuses for a crash-recovered marker with no run in flight', async () => {
    const settings = {
      ...buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
      embedding_swap_target: MINILM,
    }
    await seedStores(settings)
    currentStoryStore.set({ storyId: 's1', branchId: 'b1', definition, settings })

    expect(resolveDrainConfig('s1')).toEqual({ ok: false, reason: 'no-model' })
  })
})

describe('crash recovery resolves its target from the marker', () => {
  afterEach(() => {
    storiesStore.__reset()
    currentStoryStore.__reset()
    embedderSwapStore.__reset()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  function captureResume(): { seen: () => SwapParams | undefined } {
    let params: SwapParams | undefined
    vi.mocked(resumeSwap).mockImplementation(async (_deps, p) => {
      params = p
      return 'completed'
    })
    return { seen: () => params }
  }

  it('resumes a cross-backend swap against the marker backend, not the story backend', async () => {
    const { ctx } = await seedStores(
      {
        ...buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
        embedding_swap_target: TARGET_MODEL,
        embedding_swap_backend: 'provider',
        embedding_swap_provider_id: 'prov1',
      },
      [cachedProvider('prov1', [{ id: TARGET_MODEL }])],
    )
    const { seen } = captureResume()

    await expect(resumeStorySwap('s1', ctx)).resolves.toBe('completed')

    // The marker is the only record a crash leaves behind. Resolving it against
    // the story's still-local backend fails as `unknown-local-model`, which wedges
    // resume AND cancel and leaves the marker disabling every other action.
    expect(seen()?.targetConfig).toMatchObject({
      backend: 'provider',
      providerId: 'prov1',
      modelId: TARGET_MODEL,
    })
    expect(seen()?.currentModelId).toBe(MINILM)
    expect(seen()?.sourceDim).toBeUndefined()
    expect(seen()?.targetDim).toBeUndefined()
  })

  it('threads persisted swap dimensions into resume parameters', async () => {
    const { ctx } = await seedStores({
      ...buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
      embedding_swap_target: MINILM,
      embedding_swap_source_dim: 384,
      embedding_swap_target_dim: 768,
    })
    const { seen } = captureResume()

    await expect(resumeStorySwap('s1', ctx)).resolves.toBe('completed')

    expect(seen()).toMatchObject({ sourceDim: 384, targetDim: 768 })
  })

  it('treats an absent swap backend as the story own backend', async () => {
    const { ctx } = await seedStores({
      ...buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
      embedding_swap_target: MINILM,
    })
    const { seen } = captureResume()

    await expect(resumeStorySwap('s1', ctx)).resolves.toBe('completed')

    // Markers written before cross-backend swaps carry no backend at all; they
    // have to keep resolving rather than needing a migration.
    expect(seen()?.targetConfig).toMatchObject({ backend: 'local', modelId: MINILM })
  })

  it('refuses to resume a story with no marker', async () => {
    const { ctx } = await seedStores(
      buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
    )

    await expect(resumeStorySwap('s1', ctx)).rejects.toBeInstanceOf(SwapNotInProgressError)
    expect(resumeSwap).not.toHaveBeenCalled()
  })

  it('cancels a crash-recovered swap from the marker with no loop running', async () => {
    const { ctx } = await seedStores(
      {
        ...buildStorySettings({ embeddingBackend: 'local' }, MINILM, null),
        embedding_swap_target: TARGET_MODEL,
        embedding_swap_backend: 'provider',
        embedding_swap_provider_id: 'prov1',
        embedding_swap_source_dim: 384,
        embedding_swap_target_dim: 1536,
      },
      [cachedProvider('prov1', [{ id: TARGET_MODEL }])],
    )

    // The real unwind needs a vec0 bridge this layer's tests do not have; the
    // resolution under test happens before it.
    vi.mocked(cancelSwap).mockImplementationOnce(async () => {})

    // Resolving the marker against the story's local backend would fail as
    // `unknown-local-model` and throw SwapConfigError before reaching the unwind,
    // so getting 'cancelled' at all is half the assertion.
    await expect(cancelStorySwap('s1', ctx)).resolves.toBe('cancelled')

    expect(vi.mocked(cancelSwap).mock.lastCall?.[1]).toMatchObject({
      storyId: 's1',
      targetModelId: TARGET_MODEL,
      currentModelId: MINILM,
      sourceDim: 384,
      targetDim: 1536,
    })
  })

  it('re-indexes on the story own backend, not a bare model id', async () => {
    const { ctx } = await seedStores(
      buildStorySettings({ embeddingBackend: 'provider' }, PROVIDER_MODEL, 'prov1'),
      [cachedProvider('prov1', [{ id: PROVIDER_MODEL }])],
    )
    let params: SwapParams | undefined
    vi.mocked(reindexStory).mockImplementation(async (_deps, p) => {
      params = p
      return 'completed'
    })

    await expect(reindexStoryNow('s1', ctx)).resolves.toBe('completed')

    // Dropping the backend here resolves a provider model as a local one.
    expect(params?.targetConfig).toMatchObject({
      backend: 'provider',
      providerId: 'prov1',
      modelId: PROVIDER_MODEL,
    })
  })
})
