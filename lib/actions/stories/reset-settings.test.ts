import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  APP_SETTINGS_DEFAULTS,
  branches,
  buildStorySettings,
  deltas,
  emptyEntityState,
  entities,
  setSwapTargetOp,
  stories,
  storyDefinitionSchema,
  storyEntries,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { hydrateAppSettings, resetAllStores, storiesStore } from '@/lib/stores'

import { resetStorySettings } from './reset-settings'
import { StorySettingsStaleStoreError } from './update-story-settings'

const STORY_DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'entity_1',
  narration: 'third',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

const HEALTHY_STORY_DEFINITION = storyDefinitionSchema.parse({
  mode: 'creative',
  leadEntityId: null,
  narration: 'third',
  genre: { label: 'Mystery', promptBody: 'cozy mystery' },
  tone: { label: 'Warm', promptBody: 'warm' },
  setting: 'A quiet village.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

afterEach(() => {
  resetAllStores()
})

// Distinct from DEFAULT_SUGGESTION_CATEGORIES so the "rebuilds current
// defaults" assertions can tell "seeded from the current app store" apart
// from "fell back to the module constant" — both would otherwise produce the
// same palette and the test couldn't distinguish them.
const CURRENT_SUGGESTION_CATEGORIES = {
  adventure: [
    {
      id: 'cat_current',
      label: 'Current',
      promptHint: 'h',
      color: 'pink',
      enabled: true,
      order: 0,
    },
  ],
  creative: [
    {
      id: 'cat_current',
      label: 'Current',
      promptHint: 'h',
      color: 'orange',
      enabled: true,
      order: 0,
    },
  ],
}

async function hydrateCurrentDefaults(): Promise<void> {
  await hydrateAppSettings(async () => ({
    ...APP_SETTINGS_DEFAULTS,
    embeddingModelId: 'app-embed',
    defaultStorySettings: {
      ...APP_SETTINGS_DEFAULTS.defaultStorySettings,
      classifierCadence: 11,
      chapterAutoClose: false,
    },
    defaultSuggestionCategories: CURRENT_SUGGESTION_CATEGORIES,
  }))
}

// A provider-backed app selection: the repair reads the backend off this
// template, so the app half of every fallback differs from the local one above.
async function hydrateProviderDefaults(): Promise<void> {
  await hydrateAppSettings(async () => ({
    ...APP_SETTINGS_DEFAULTS,
    embeddingModelId: 'app-embed',
    embeddingProviderId: 'prov_app',
    defaultStorySettings: {
      ...APP_SETTINGS_DEFAULTS.defaultStorySettings,
      classifierCadence: 11,
      embeddingBackend: 'provider',
    },
    defaultSuggestionCategories: CURRENT_SUGGESTION_CATEGORIES,
  }))
}

// Mirrors what hydrateCurrentDefaults() puts in the app-settings store, so the
// "rebuilds current defaults" assertions can reconstruct resetStorySettings'
// expected output byte-for-byte.
function currentAppDefaults() {
  return {
    defaultStorySettings: {
      ...APP_SETTINGS_DEFAULTS.defaultStorySettings,
      classifierCadence: 11,
      chapterAutoClose: false,
    },
    embeddingModelId: 'app-embed',
    embeddingProviderId: null,
    defaultSuggestionCategories: CURRENT_SUGGESTION_CATEGORIES,
  }
}

// Seeds a story row's pre-reset settings; the specific values are overwritten
// by resetStorySettings in every test that reaches it, so the palette content
// doesn't matter here.
function seedSettings(
  mode: 'adventure' | 'creative',
  classifierCadence: number,
  embeddingModelId: string,
) {
  return buildStorySettings(mode, {
    defaultStorySettings: { classifierCadence },
    embeddingModelId,
    embeddingProviderId: null,
    defaultSuggestionCategories: { adventure: [], creative: [] },
  })
}

describe('resetStorySettings', () => {
  it('rebuilds current defaults and preserves definition, entries, entities, and deltas', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    const oldSettings = seedSettings('adventure', 2, 'old-embed')
    const healthySettings = seedSettings('creative', 4, 'other-embed')

    await db.insert(stories).values([
      {
        id: 'story_1',
        title: 'Broken',
        status: 'active',
        currentBranchId: 'branch_1',
        definition: STORY_DEFINITION,
        settings: oldSettings,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'story_2',
        title: 'Healthy',
        status: 'active',
        definition: HEALTHY_STORY_DEFINITION,
        settings: healthySettings,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await db
      .insert(branches)
      .values({ id: 'branch_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    await db.insert(storyEntries).values({
      id: 'entry_1',
      branchId: 'branch_1',
      position: 1,
      kind: 'opening',
      content: 'Opening content.',
      createdAt: 1,
    })
    await db.insert(entities).values({
      id: 'entity_1',
      branchId: 'branch_1',
      kind: 'character',
      name: 'Aria',
      status: 'active',
      injectionMode: 'auto',
      state: emptyEntityState('character'),
      createdAt: 1,
      updatedAt: 1,
    })
    await db.insert(deltas).values({
      id: 'delta_1',
      branchId: 'branch_1',
      entryId: 'entry_1',
      actionId: 'action_1',
      logPosition: 1,
      source: 'user_edit',
      targetTable: 'story_entries',
      targetId: 'entry_1',
      op: 'create',
      undoPayload: null,
      createdAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"classifierCadence":"broken"}' WHERE id = 'story_1'`,
    )
    await hydrateCurrentDefaults()
    storiesStore.setOpenFailure({ storyId: 'story_1', kind: 'settings-corrupt' })

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    const [healthy] = await db.select().from(stories).where(eq(stories.id, 'story_2'))
    const entryRows = await db.select().from(storyEntries)
    const entityRows = await db.select().from(entities)
    const deltaRows = await db.select().from(deltas)

    expect(recovered.settings).toEqual(buildStorySettings('adventure', currentAppDefaults()))
    expect(recovered.definition).toEqual(STORY_DEFINITION)
    expect(recovered.updatedAt).toBe(99)
    expect(healthy.settings).toEqual(healthySettings)
    expect(entryRows).toHaveLength(1)
    expect(entityRows).toHaveLength(1)
    expect(deltaRows).toHaveLength(1)
    expect(deltaRows[0]).toMatchObject({ id: 'delta_1', actionId: 'action_1' })
    expect(storiesStore.getStories().openFailures.story_1).toBeUndefined()
  })

  it('rejects an unknown story without writing a story', async () => {
    const { db, runInTransaction } = await createTestDb()
    await hydrateCurrentDefaults()

    await expect(resetStorySettings('missing', { db, runInTransaction }, 99)).rejects.toThrow(
      'Story not found',
    )

    expect(await db.select().from(stories)).toEqual([])
  })

  it('retains the open failure when the stories mirror cannot refresh', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    await hydrateCurrentDefaults()
    storiesStore.setOpenFailure({ storyId: 'story_1', kind: 'settings-corrupt' })
    const writeThenBreakRefresh: typeof runInTransaction = async (ops) => {
      await runInTransaction(ops)
      sqlite.exec('DROP TABLE stories')
    }

    // Throws rather than resolving: the flag stays set, so a silent success would
    // send attemptOpenStory straight back into the recovery dialog just used.
    await expect(
      resetStorySettings('story_1', { db, runInTransaction: writeThenBreakRefresh }, 99),
    ).rejects.toBeInstanceOf(StorySettingsStaleStoreError)

    expect(storiesStore.getStories().openFailures.story_1).toBe('settings-corrupt')
  })

  it('falls back to the wizard default mode when resetting a row with a null definition', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_draft',
      title: 'Untitled story',
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    })
    await hydrateCurrentDefaults()

    await resetStorySettings('story_draft', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_draft'))
    expect(recovered.settings).toEqual(buildStorySettings('creative', currentAppDefaults()))
  })

  it('retains a definition failure after successfully resetting settings', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    await hydrateCurrentDefaults()
    storiesStore.setOpenFailure({ storyId: 'story_1', kind: 'definition-corrupt' })

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    expect(storiesStore.getStories().openFailures.story_1).toBe('definition-corrupt')
  })

  // retrieval.md → Matryoshka effective dim locks the trio at creation: every
  // stored vector is under that model at that dim, and a relabel leaves nothing
  // to re-derive staleness from.
  it('preserves the creation-locked embedding trio while rebuilding everything else', async () => {
    const { db, runInTransaction } = await createTestDb()
    const locked = buildStorySettings(
      'adventure',
      {
        defaultStorySettings: { classifierCadence: 2 },
        embeddingModelId: 'locked-embed',
        embeddingProviderId: 'provider_locked',
        defaultSuggestionCategories: { adventure: [], creative: [] },
      },
      1024,
    )
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Locked',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: locked,
      createdAt: 1,
      updatedAt: 1,
    })
    await hydrateCurrentDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embedding_model_id).toBe('locked-embed')
    expect(recovered.settings?.embedding_provider_id).toBe('provider_locked')
    expect(recovered.settings?.effectiveDim).toBe(1024)
    // The rest still rebuilds: seeded cadence was 2, current app default is 11.
    expect(recovered.settings?.classifierCadence).toBe(11)
    expect(recovered.settings?.suggestionCategories).toEqual(
      CURRENT_SUGGESTION_CATEGORIES.adventure,
    )
  })

  // A swap registers no RunState, so nothing gates a reset mid-swap; rebuilding
  // the markers away strands its staged vectors with no record of their target.
  it('leaves every engine-owned key alone while a swap is admitted', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Swapping',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: buildStorySettings(
        'adventure',
        {
          defaultStorySettings: { classifierCadence: 2, embeddingBackend: 'provider' },
          embeddingModelId: 'locked-embed',
          embeddingProviderId: 'provider_locked',
          defaultSuggestionCategories: { adventure: [], creative: [] },
        },
        1024,
      ),
      createdAt: 1,
      updatedAt: 1,
    })
    await hydrateCurrentDefaults()
    await runInTransaction([
      setSwapTargetOp(
        'story_1',
        { modelId: 'target-model', backend: 'provider', providerId: 'provider_target' },
        50,
        { sourceDim: 1024, targetDim: 768 },
      ),
    ])

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    // These pin the contract, not ENGINE_OWNED_KEYS: the key-scoped write is what
    // spares them, so they go red only on a return to a whole-blob write.
    expect(recovered.settings?.embedding_swap_target).toBe('target-model')
    expect(recovered.settings?.embedding_swap_backend).toBe('provider')
    expect(recovered.settings?.embedding_swap_provider_id).toBe('provider_target')
    expect(recovered.settings?.embedding_swap_source_dim).toBe(1024)
    expect(recovered.settings?.embedding_swap_target_dim).toBe(768)
    // The rest bite on the set. The backend is engine-owned too — the app default
    // is 'local', so rebuilding it would strand a provider model id under it.
    expect(recovered.settings?.embeddingBackend).toBe('provider')
    expect(recovered.settings?.embedding_model_id).toBe('locked-embed')
    expect(recovered.settings?.embedding_provider_id).toBe('provider_locked')
    expect(recovered.settings?.effectiveDim).toBe(1024)
    // Everything user-facing still resets: seeded cadence was 2, app default 11.
    expect(recovered.settings?.classifierCadence).toBe(11)
    expect(recovered.settings?.suggestionCategories).toEqual(
      CURRENT_SUGGESTION_CATEGORIES.adventure,
    )
    expect(recovered.updatedAt).toBe(99)
  })

  // The backend says which embedder the model id names, so carrying one without
  // the other resolves the story onto an embedder its vectors never came from.
  it('carries a readable backend across the corrupt-blob repair', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"classifierCadence":"broken","embeddingBackend":"provider","embedding_model_id":"text-embedding-3-small","embedding_provider_id":"prov_1","effectiveDim":512}' WHERE id = 'story_1'`,
    )
    await hydrateCurrentDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embeddingBackend).toBe('provider')
    expect(recovered.settings?.embedding_model_id).toBe('text-embedding-3-small')
    expect(recovered.settings?.embedding_provider_id).toBe('prov_1')
    expect(recovered.settings?.effectiveDim).toBe(512)
    expect(recovered.settings?.classifierCadence).toBe(11)
  })

  // Mirrors setEmbeddingTargetOp's flip: truncation is provider-only, so on local
  // both keys would describe nothing while still reading as live settings.
  it('drops the provider-only keys when the repaired backend is local', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"classifierCadence":"broken","embeddingBackend":"local","embedding_model_id":"Xenova/all-MiniLM-L6-v2","embedding_provider_id":"prov_1","effectiveDim":512}' WHERE id = 'story_1'`,
    )
    await hydrateCurrentDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embeddingBackend).toBe('local')
    expect(recovered.settings?.embedding_model_id).toBe('Xenova/all-MiniLM-L6-v2')
    expect(recovered.settings?.embedding_provider_id).toBeUndefined()
    expect(recovered.settings?.effectiveDim).toBeUndefined()
  })

  // Either can survive alone: a backend carried over a defaulted model id points
  // a provider at the bundled local model, resolving `ok` then dying in the call.
  it('drops a surviving backend when the model id it labels did not', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"embeddingBackend":"provider","embedding_model_id":42,"embedding_provider_id":"prov_1","effectiveDim":512}' WHERE id = 'story_1'`,
    )
    await hydrateCurrentDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embeddingBackend).toBe('local')
    expect(recovered.settings?.embedding_model_id).toBe('app-embed')
    expect(recovered.settings?.embedding_provider_id).toBeUndefined()
    expect(recovered.settings?.effectiveDim).toBeUndefined()
  })

  // A blank id names no embedder, so it must not carry the backend across either.
  it('treats a blank model id as absent rather than repairing to an empty string', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"classifierCadence":"broken","embeddingBackend":"provider","embedding_model_id":"","embedding_provider_id":"prov_1"}' WHERE id = 'story_1'`,
    )
    await hydrateCurrentDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embedding_model_id).toBe('app-embed')
    expect(recovered.settings?.embeddingBackend).toBe('local')
  })

  // Relabelling onto the app's embedder strands every vector under a model_id
  // knnQuery cannot match; without the dirty flip the index reads clean forever.
  it('dirties the whole index when the repair drops the story embedder', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    await db
      .insert(branches)
      .values({ id: 'branch_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    await db.insert(entities).values({
      id: 'entity_1',
      branchId: 'branch_1',
      kind: 'character',
      name: 'Aria',
      status: 'active',
      injectionMode: 'auto',
      state: emptyEntityState('character'),
      createdAt: 1,
      updatedAt: 1,
    })
    // Explicitly clean, so the assertion cannot pass on the column default.
    sqlite.exec(`UPDATE entities SET embedding_stale = 0 WHERE id = 'entity_1'`)
    sqlite.exec(
      `UPDATE stories SET settings = '{"embeddingBackend":"prvoider","embedding_model_id":"Xenova/all-MiniLM-L6-v2"}' WHERE id = 'story_1'`,
    )
    await hydrateProviderDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    // Precondition: the carry really did drop, so the flip below is the relabel's
    // consequence and not an unconditional dirty.
    expect(recovered.settings?.embedding_model_id).toBe('app-embed')
    const [entity] = await db.select().from(entities).where(eq(entities.id, 'entity_1'))
    expect(entity.embeddingStale).toBe(1)
  })

  // The other half of the pair: a repair that keeps the story's embedder leaves
  // its vectors valid, so dirtying the index would buy a pointless re-embed.
  it('leaves the index alone when the repair carries the story embedder', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    await db
      .insert(branches)
      .values({ id: 'branch_1', storyId: 'story_1', name: 'main', createdAt: 1 })
    await db.insert(entities).values({
      id: 'entity_1',
      branchId: 'branch_1',
      kind: 'character',
      name: 'Aria',
      status: 'active',
      injectionMode: 'auto',
      state: emptyEntityState('character'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(`UPDATE entities SET embedding_stale = 0 WHERE id = 'entity_1'`)
    // Readable backend AND model id, with only an unrelated key corrupt.
    sqlite.exec(
      `UPDATE stories SET settings = '{"embeddingBackend":"local","embedding_model_id":"Xenova/all-MiniLM-L6-v2","classifierCadence":"broken"}' WHERE id = 'story_1'`,
    )
    await hydrateProviderDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embedding_model_id).toBe('Xenova/all-MiniLM-L6-v2')
    const [entity] = await db.select().from(entities).where(eq(entities.id, 'entity_1'))
    expect(entity.embeddingStale).toBe(0)
  })

  it('takes the app selection whole when the backend did not survive', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"embeddingBackend":"prvoider","embedding_model_id":"Xenova/all-MiniLM-L6-v2","embedding_provider_id":"prov_stale","effectiveDim":512}' WHERE id = 'story_1'`,
    )
    await hydrateProviderDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embeddingBackend).toBe('provider')
    expect(recovered.settings?.embedding_model_id).toBe('app-embed')
    expect(recovered.settings?.embedding_provider_id).toBe('prov_app')
    expect(recovered.settings?.effectiveDim).toBeUndefined()
  })

  // Same mix from the other side: a readable backend over a defaulted model id,
  // with the story's stale provider id riding along.
  it('takes the app selection whole when the model id did not survive', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"embeddingBackend":"provider","embedding_model_id":42,"embedding_provider_id":"prov_stale","effectiveDim":512}' WHERE id = 'story_1'`,
    )
    await hydrateProviderDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embeddingBackend).toBe('provider')
    expect(recovered.settings?.embedding_model_id).toBe('app-embed')
    expect(recovered.settings?.embedding_provider_id).toBe('prov_app')
    expect(recovered.settings?.effectiveDim).toBeUndefined()
  })

  // A whitespace-only id names no embedder either, and `resolveEmbedderConfig`
  // trims before its own emptiness check.
  it('takes the app selection whole for a whitespace-only model id', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"embeddingBackend":"provider","embedding_model_id":"   ","embedding_provider_id":"prov_stale"}' WHERE id = 'story_1'`,
    )
    await hydrateProviderDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embedding_model_id).toBe('app-embed')
    expect(recovered.settings?.embedding_provider_id).toBe('prov_app')
  })

  // The same fallback against a local app selection: a provider-shaped model id
  // survived, but without the backend that labels it that is not an embedder.
  it('discards a surviving provider model id when the backend did not survive', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"embeddingBackend":"prvoider","embedding_model_id":"text-embedding-3-small","embedding_provider_id":"prov_1","effectiveDim":512}' WHERE id = 'story_1'`,
    )
    await hydrateCurrentDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embeddingBackend).toBe('local')
    expect(recovered.settings?.embedding_model_id).toBe('app-embed')
    expect(recovered.settings?.embedding_provider_id).toBeUndefined()
    expect(recovered.settings?.effectiveDim).toBeUndefined()
  })

  it('falls back to app defaults when the corrupt blob has no usable trio', async () => {
    const { db, sqlite, runInTransaction } = await createTestDb()
    await db.insert(stories).values({
      id: 'story_1',
      title: 'Broken',
      status: 'active',
      definition: STORY_DEFINITION,
      settings: seedSettings('adventure', 2, 'old-embed'),
      createdAt: 1,
      updatedAt: 1,
    })
    sqlite.exec(
      `UPDATE stories SET settings = '{"embedding_model_id":42,"effectiveDim":-8}' WHERE id = 'story_1'`,
    )
    await hydrateCurrentDefaults()

    await resetStorySettings('story_1', { db, runInTransaction }, 99)

    const [recovered] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(recovered.settings?.embedding_model_id).toBe('app-embed')
    expect(recovered.settings?.effectiveDim).toBeUndefined()
  })
})
