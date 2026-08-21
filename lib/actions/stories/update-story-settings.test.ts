import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  branches,
  buildStorySettings,
  setSwapTargetOp,
  stories,
  storyDefinitionSchema,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import {
  currentStoryStore,
  generationStore,
  resetAllStores,
  storiesStore,
  type RunState,
} from '@/lib/stores'

import { StorySettingsStaleStoreError, updateStorySettings } from './update-story-settings'

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

afterEach(() => {
  resetAllStores()
})

// classifierCadence and suggestionCount must stay different from
// STORY_SETTINGS_DEFAULTS (5 and 3): the merge assertions can only tell a
// preserved value from a re-defaulted one while those differ.
async function seed() {
  const { db, sqlite, runInTransaction } = await createTestDb()
  const settings = buildStorySettings('adventure', {
    defaultStorySettings: {
      classifierCadence: 2,
      suggestionCount: 6,
      // Pinned false so the currentStoryStore test below can observe a real
      // false→true transition; the new story-creation default is true.
      suggestionsEnabled: false,
      models: { narrative: 'model-a', classifier: 'model-b' },
    },
    embeddingModelId: 'embed-a',
    embeddingProviderId: null,
    defaultSuggestionCategories: { adventure: [], creative: [] },
  })
  await db.insert(stories).values({
    id: 'story_1',
    title: 'Aria',
    status: 'active',
    currentBranchId: 'branch_1',
    definition: STORY_DEFINITION,
    settings,
    createdAt: 1,
    updatedAt: 1,
  })
  await db
    .insert(branches)
    .values({ id: 'branch_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  return { db, sqlite, runInTransaction, settings }
}

function startRun(kind: string, gateBehavior: RunState['gateBehavior']): void {
  generationStore.startRun({
    runId: `run-${kind}`,
    kind,
    gateBehavior,
    actionId: `action-${kind}`,
    storyId: 'story_1',
    branchId: 'branch_1',
    abortController: new AbortController(),
    currentPhase: 'running',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

describe('updateStorySettings', () => {
  it.each([PER_TURN_KIND, 'chapter-close', SUGGESTION_REFRESH_KIND])(
    'rejects settings writes while %s owns the hard gate',
    async (kind) => {
      const { db, runInTransaction } = await seed()
      startRun(kind, 'hard-gate')

      const result = await updateStorySettings(
        'story_1',
        { suggestionCount: 2 },
        { db, runInTransaction },
        99,
      )

      expect(result).toEqual({ status: 'rejected', reason: 'generation in flight' })
      const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
      expect(row.settings?.suggestionCount).toBe(6)
      expect(row.updatedAt).toBe(1)
    },
  )

  it('allows settings writes while only a no-gate run is active', async () => {
    const { db, runInTransaction } = await seed()
    startRun('periodic-classifier', 'no-gate')

    const result = await updateStorySettings(
      'story_1',
      { suggestionCount: 2 },
      { db, runInTransaction },
      99,
    )

    expect(result).toMatchObject({ status: 'ok', settings: { suggestionCount: 2 } })
  })

  it('merges the patch without clobbering sibling fields', async () => {
    const { db, runInTransaction, settings } = await seed()

    const next = await updateStorySettings(
      'story_1',
      { suggestionCount: 5 },
      { db, runInTransaction },
      99,
    )

    expect(next).toMatchObject({ status: 'ok' })
    if (next.status !== 'ok') throw new Error('expected the settings write to succeed')
    expect(next.settings.suggestionCount).toBe(5)
    expect(next.settings.classifierCadence).toBe(2)
    expect(next.settings.embedding_model_id).toBe(settings.embedding_model_id)

    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.settings?.suggestionCount).toBe(5)
    expect(row.settings?.classifierCadence).toBe(2)
    expect(row.updatedAt).toBe(99)

    const mirrored = storiesStore.getStories().rows.find((r) => r.id === 'story_1')
    expect(mirrored?.settings?.suggestionCount).toBe(5)
    expect(mirrored?.updatedAt).toBe(99)
  })

  it('replaces nested objects wholesale rather than merging them', async () => {
    const { db, runInTransaction, settings } = await seed()
    expect(settings.models).toEqual({ narrative: 'model-a', classifier: 'model-b' })

    const next = await updateStorySettings(
      'story_1',
      { models: { narrative: 'model-c' } },
      { db, runInTransaction },
      99,
    )

    expect(next).toMatchObject({ status: 'ok' })
    if (next.status !== 'ok') throw new Error('expected the settings write to succeed')
    expect(next.settings.models).toEqual({ narrative: 'model-c' })
  })

  it('a save landing mid-swap leaves the swap marker keys intact', async () => {
    const { db, runInTransaction } = await seed()

    // Injects the swap's phase-1 marker write between the action's validation
    // and its own write — the exact interleave a read-merge-write loses.
    const interleaved: typeof runInTransaction = async (ops) => {
      await runInTransaction([
        setSwapTargetOp(
          'story_1',
          { modelId: 'target-model', backend: 'provider', providerId: 'prov_1' },
          50,
        ),
      ])
      await runInTransaction(ops)
    }

    const result = await updateStorySettings(
      'story_1',
      { suggestionCount: 2 },
      { db, runInTransaction: interleaved },
      99,
    )

    expect(result).toMatchObject({ status: 'ok' })
    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.settings?.suggestionCount).toBe(2)
    expect(row.settings?.embedding_swap_target).toBe('target-model')
    expect(row.settings?.embedding_swap_backend).toBe('provider')
    expect(row.settings?.embedding_swap_provider_id).toBe('prov_1')
  })

  // json_patch would delete the key, and activePackId is required-nullable, so
  // the next read would report the whole blob corrupt.
  it('writes an explicit null without deleting the key', async () => {
    const { db, sqlite, runInTransaction } = await seed()

    const result = await updateStorySettings(
      'story_1',
      { activePackId: null },
      { db, runInTransaction },
      99,
    )

    expect(result).toMatchObject({ status: 'ok', settings: { activePackId: null } })
    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.settings?.activePackId).toBeNull()
    const [stored] = sqlite
      .prepare(
        `SELECT json_type(settings, '$.activePackId') AS t FROM stories WHERE id = 'story_1'`,
      )
      .all() as { t: string | null }[]
    expect(stored.t).toBe('null')
  })

  it('refreshes currentStoryStore when the updated story is open', async () => {
    const { db, runInTransaction, settings } = await seed()
    currentStoryStore.set({
      storyId: 'story_1',
      branchId: 'branch_1',
      definition: STORY_DEFINITION,
      settings,
    })

    expect(settings.suggestionsEnabled).toBe(false)

    await updateStorySettings('story_1', { suggestionsEnabled: true }, { db, runInTransaction }, 99)

    expect(currentStoryStore.getCurrentStory()?.settings.suggestionsEnabled).toBe(true)
    expect(currentStoryStore.getCurrentStory()?.settings.classifierCadence).toBe(2)
    expect(currentStoryStore.getCurrentStory()?.branchId).toBe('branch_1')
    expect(currentStoryStore.getCurrentStory()?.definition).toEqual(STORY_DEFINITION)
  })

  it('leaves currentStoryStore alone when a different story is open', async () => {
    const { db, runInTransaction, settings } = await seed()
    currentStoryStore.set({
      storyId: 'story_other',
      branchId: 'branch_other',
      definition: STORY_DEFINITION,
      settings,
    })

    await updateStorySettings('story_1', { suggestionCount: 4 }, { db, runInTransaction }, 99)

    expect(currentStoryStore.getCurrentStory()?.storyId).toBe('story_other')
    expect(currentStoryStore.getCurrentStory()?.settings.suggestionCount).toBe(
      settings.suggestionCount,
    )
  })

  it('treats an undefined-valued key as untouched rather than a reset to default', async () => {
    const { db, runInTransaction, settings } = await seed()
    expect(settings.suggestionCount).toBe(6)

    const next = await updateStorySettings(
      'story_1',
      { suggestionCount: undefined, piggybackMode: 'on' },
      { db, runInTransaction },
      99,
    )

    expect(next).toMatchObject({ status: 'ok' })
    if (next.status !== 'ok') throw new Error('expected the settings write to succeed')
    expect(next.settings.suggestionCount).toBe(6)
    expect(next.settings.piggybackMode).toBe('on')

    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.settings?.suggestionCount).toBe(6)
  })

  // json_set needs at least one path/value pair: without the guard an empty
  // patch emits `json_set(settings, )`, a SQL syntax error.
  it('emits no UPDATE when the patch has nothing to set', async () => {
    const { db, runInTransaction } = await seed()

    const next = await updateStorySettings('story_1', {}, { db, runInTransaction }, 99)

    expect(next).toMatchObject({ status: 'ok' })
    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.updatedAt).toBe(1)
  })

  it('rejects rather than self-heals when the stored settings are corrupt', async () => {
    const { db, sqlite, runInTransaction, settings } = await seed()
    const corrupt = JSON.stringify({ ...settings, classifierCadence: 'broken' })
    sqlite.exec(`UPDATE stories SET settings = '${corrupt}' WHERE id = 'story_1'`)

    await expect(
      updateStorySettings('story_1', { suggestionCount: 5 }, { db, runInTransaction }, 99),
    ).rejects.toThrow()

    // The corrupt key is outside the patch, so it must survive rather than be
    // rebuilt from defaults by a save that reports failure.
    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.settings?.classifierCadence).toBe('broken')
    expect(storiesStore.getStories().openFailures.story_1).toBe('settings-corrupt')
  })

  // The write is key-scoped, so overwriting the corrupt key leaves a readable
  // blob; a stale repair flag strands the story behind attemptOpenStory's gate.
  it('clears the repair flag when the save makes the settings readable again', async () => {
    const { db, sqlite, runInTransaction, settings } = await seed()
    const corrupt = JSON.stringify({ ...settings, classifierCadence: 'broken' })
    sqlite.exec(`UPDATE stories SET settings = '${corrupt}' WHERE id = 'story_1'`)

    await expect(
      updateStorySettings('story_1', { suggestionCount: 5 }, { db, runInTransaction }, 99),
    ).rejects.toThrow()
    expect(storiesStore.getStories().openFailures.story_1).toBe('settings-corrupt')

    const next = await updateStorySettings(
      'story_1',
      { classifierCadence: 7 },
      { db, runInTransaction },
      100,
    )

    expect(next).toMatchObject({ status: 'ok', settings: { classifierCadence: 7 } })
    expect(storiesStore.getStories().openFailures.story_1).toBeUndefined()
  })

  it('throws for an unknown story', async () => {
    const { db, runInTransaction } = await seed()

    await expect(
      updateStorySettings('story_missing', { suggestionCount: 2 }, { db, runInTransaction }, 99),
    ).rejects.toThrow('Story not found')
  })

  it('rejects an invalid patch without writing', async () => {
    const { db, runInTransaction } = await seed()

    await expect(
      updateStorySettings(
        'story_1',
        { suggestionCount: 'lots' } as never,
        { db, runInTransaction },
        99,
      ),
    ).rejects.toThrow()

    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.updatedAt).toBe(1)
  })

  // Zod strips unknown keys, so without an explicit check a typo'd key reports
  // a successful save that wrote nothing.
  it('rejects an unknown key by name instead of silently dropping it', async () => {
    const { db, runInTransaction } = await seed()

    await expect(
      updateStorySettings('story_1', { suggestionCoutn: 4 } as never, { db, runInTransaction }, 99),
    ).rejects.toThrow('suggestionCoutn')

    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.updatedAt).toBe(1)
  })

  // `key in shape` passes for every Object.prototype member, so these reached
  // zod, were stripped, and reported a successful save that wrote nothing.
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
    'rejects the prototype key %s instead of silently dropping it',
    async (key) => {
      const { db, runInTransaction } = await seed()

      await expect(
        updateStorySettings('story_1', { [key]: 'x' } as never, { db, runInTransaction }, 99),
      ).rejects.toThrow(key)

      const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
      expect(row.updatedAt).toBe(1)
    },
  )

  it('flags the story for repair when the stored settings are unreadable', async () => {
    const { db, sqlite, runInTransaction } = await seed()
    sqlite.exec(`UPDATE stories SET settings = NULL WHERE id = 'story_1'`)

    await expect(
      updateStorySettings('story_1', { suggestionCount: 2 }, { db, runInTransaction }, 99),
    ).rejects.toThrow()

    expect(storiesStore.getStories().openFailures.story_1).toBe('settings-corrupt')
  })

  it('reports a stale store distinctly from a failed save', async () => {
    const { db, runInTransaction, settings } = await seed()
    // The write lands, then rehydrateStories' re-read fails — the user must
    // not be told their changes were lost. The action's own select is the
    // first; the store's re-read is the second.
    let selects = 0
    const brokenDb = new Proxy(db, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown
        if (prop !== 'select' || typeof value !== 'function') {
          return typeof value === 'function' ? value.bind(target) : value
        }
        return (...args: unknown[]) => {
          selects += 1
          if (selects > 1) throw new Error('read failed')
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      },
    })

    await expect(
      updateStorySettings(
        'story_1',
        { suggestionCount: 2 },
        { db: brokenDb, runInTransaction },
        99,
      ),
    ).rejects.toBeInstanceOf(StorySettingsStaleStoreError)

    const [row] = await db.select().from(stories).where(eq(stories.id, 'story_1'))
    expect(row.settings?.suggestionCount).toBe(2)
    expect(row.updatedAt).toBe(99)
    expect(settings.suggestionCount).toBe(6)
  })
})
