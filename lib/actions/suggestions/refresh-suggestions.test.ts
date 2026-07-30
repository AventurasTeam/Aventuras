import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  APP_SETTINGS_DEFAULTS,
  deltas,
  entryMetadataSchema,
  storyEntries,
  STORY_SETTINGS_DEFAULTS,
  type StorySettings,
} from '@/lib/db'
import { makeHarness, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import { appSettingsStore, currentStoryStore, entitiesStore, entriesStore } from '@/lib/stores'

import { refreshSuggestions } from './refresh-suggestions'
import { undoLastAction } from '../story-entries/undo'

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, generateStructured: generateStructuredMock }
})

const definition = {
  mode: 'adventure' as const,
  leadEntityId: null,
  narration: 'first' as const,
  genre: { label: 'Fantasy', promptBody: '' },
  tone: { label: 'Wry', promptBody: '' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
}

const SUGGESTION_CATEGORIES = [
  { id: 'cat_action', label: 'Action', promptHint: 'act', color: 'red', enabled: true, order: 0 },
]

const provider = {
  id: 'prov-1',
  type: 'anthropic' as const,
  displayName: 'Anthropic',
  apiKey: 'key',
  favoriteModelIds: [],
}

const ENTRY = {
  id: 'entry-1',
  branchId: 'b1',
  position: 1,
  kind: 'ai_reply' as const,
  content: 'The gate groans open.',
  chapterId: null,
  metadata: { sceneEntities: [], currentLocationId: null, worldTime: 7 },
  createdAt: 1,
}

function settings(overrides: Partial<StorySettings> = {}): StorySettings {
  return {
    ...STORY_SETTINGS_DEFAULTS,
    suggestionsEnabled: true,
    suggestionCount: 2,
    suggestionCategories: SUGGESTION_CATEGORIES,
    ...overrides,
  }
}

function wireAppSettings(assigned = true) {
  vi.spyOn(appSettingsStore, 'getAppSettings').mockReturnValue({
    ...APP_SETTINGS_DEFAULTS,
    providers: [provider],
    profiles: assigned
      ? [
          {
            id: 'prof-suggestion',
            kind: 'agent',
            name: 'Suggestion',
            modelRef: { providerId: provider.id, modelId: 'sug-model' },
          },
        ]
      : [],
    assignments: assigned ? { suggestion: 'prof-suggestion' } : {},
    defaultProviderId: provider.id,
  } as never)
}

async function seed(db: Awaited<ReturnType<typeof makeHarness>>['db']) {
  await db.insert(storyEntries).values(ENTRY)
  currentStoryStore.set({ storyId: 's1', branchId: 'b1', definition, settings: settings() })
  entriesStore.hydrate('b1', [ENTRY])
  entitiesStore.hydrate('b1', [])
}

beforeEach(() => {
  resetSingletons()
  vi.restoreAllMocks()
  generateStructuredMock.mockReset()
})
afterEach(() => resetSingletons())

describe('refreshSuggestions', () => {
  it('persists re-rolled chips on the target entry and delta-logs the write', async () => {
    const { db, ctx } = await makeHarness()
    await seed(db)
    wireAppSettings()
    generateStructuredMock.mockResolvedValue({
      status: 'ok',
      value: { suggestions: [{ categoryRef: 'cat1', text: 'Draw the blade.' }] },
    })

    const result = await refreshSuggestions(
      { storyId: 's1', branchId: 'b1' },
      { refreshGuidance: 'sneak around' },
      ctx,
    )

    expect(result.outcome).toBe('completed')
    const [row] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'entry-1'))
    expect(row?.metadata?.nextTurnSuggestions).toEqual({
      items: [{ categoryId: 'cat_action', text: 'Draw the blade.' }],
      source: 'refresh',
      refreshGuidance: 'sneak around',
    })
    // Scene state on the entry survives the metadata patch.
    expect(row?.metadata?.worldTime).toBe(7)

    const [delta] = await db.select().from(deltas)
    expect(delta).toMatchObject({
      targetTable: 'story_entries',
      targetId: 'entry-1',
      op: 'update',
      // Anchored to the entry it describes so a rollback that spares that entry
      // spares the chips too (data-model.md -> Survival anchor).
      entryId: 'entry-1',
    })
    expect(entriesStore.getById('entry-1')?.metadata?.nextTurnSuggestions?.source).toBe('refresh')
  })

  it('survives a CTRL-Z round trip on an entry that had no metadata at all', async () => {
    const { db, ctx } = await makeHarness()
    // The empty-state ⟳ Generate path: a legacy terminal entry written before
    // the metadata column carried a scene. Not a system entry — those are
    // refused as targets outright, since clearSystemEntry deletes the row.
    const bare = { ...ENTRY, metadata: null }
    await db.insert(storyEntries).values(bare)
    currentStoryStore.set({ storyId: 's1', branchId: 'b1', definition, settings: settings() })
    entriesStore.hydrate('b1', [bare])
    entitiesStore.hydrate('b1', [])
    wireAppSettings()
    generateStructuredMock.mockResolvedValue({
      status: 'ok',
      value: { suggestions: [{ categoryRef: 'cat1', text: 'Draw the blade.' }] },
    })
    const ids = { storyId: 's1', branchId: 'b1' }
    const input = { refreshGuidance: '' }

    await refreshSuggestions(ids, input, ctx)
    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })

    const [undone] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'entry-1'))
    expect(undone?.metadata).toBeNull()

    // Not sticky: the next re-roll still sees "no metadata" and re-applies the
    // scene floor, rather than inheriting a half-restored, unparseable blob.
    await refreshSuggestions(ids, input, ctx)
    const [again] = await db.select().from(storyEntries).where(eq(storyEntries.id, 'entry-1'))
    expect(entryMetadataSchema.safeParse(again?.metadata).success).toBe(true)
  })

  it('self-blocks a second re-roll while one is in flight', async () => {
    const { db, ctx } = await makeHarness()
    await seed(db)
    wireAppSettings()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    // A resolvable chip, so the run's terminal outcome is about the self-block
    // and not about an unusable emission (which now fails the run).
    generateStructuredMock.mockImplementation(async () => {
      await gate
      return { status: 'ok', value: { suggestions: [{ categoryRef: 'cat1', text: 'Draw.' }] } }
    })

    const inflight = refreshSuggestions(
      { storyId: 's1', branchId: 'b1' },
      { refreshGuidance: '' },
      ctx,
    )
    // Let the first run reserve itself before the second start is attempted.
    await vi.waitFor(() => expect(generateStructuredMock).toHaveBeenCalled())
    const blocked = await refreshSuggestions(
      { storyId: 's1', branchId: 'b1' },
      { refreshGuidance: '' },
      ctx,
    )

    expect(blocked).toEqual({ outcome: 'rejected', blockedBy: 'suggestion-refresh' })
    release()
    expect((await inflight).outcome).toBe('completed')
    expect(generateStructuredMock).toHaveBeenCalledTimes(1)
  })

  it('halts before phase 0 with a config-resolver failure when the suggestion agent is unassigned', async () => {
    const { db, ctx } = await makeHarness()
    await seed(db)
    wireAppSettings(false)

    const result = await refreshSuggestions(
      { storyId: 's1', branchId: 'b1' },
      { refreshGuidance: '' },
      ctx,
    )

    expect(result).toMatchObject({
      outcome: 'failed',
      error: { kind: 'config-resolver', failure: 'no-profile-assigned', target: 'suggestion' },
    })
    expect(generateStructuredMock).not.toHaveBeenCalled()
    expect(await db.select().from(deltas)).toEqual([])
  })
})
