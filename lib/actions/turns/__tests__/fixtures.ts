import { eq } from 'drizzle-orm'
import { vi } from 'vitest'

import { stories, storyDefinitionSchema, storySettingsSchema } from '@/lib/db'
import { currentStoryStore, entitiesStore, entriesStore, rehydrateStories } from '@/lib/stores'

import type { makeHarness } from '../../../pipeline/__tests__/harness'

// The phase streams via the real openai-compatible provider path; stub global
// fetch (a call-time seam, unlike a module mock of the AI/provider graph, which
// the setup-file's eager load of that graph would defeat) with a canned OpenAI
// SSE stream so the happy path gets deterministic streamed tokens without a
// network round-trip.
export function sseFetch(tokens: readonly string[]): typeof fetch {
  const chunks = tokens.map(
    (content) =>
      `data: ${JSON.stringify({
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`,
  )
  chunks.push(
    `data: ${JSON.stringify({
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
    'data: [DONE]\n\n',
  )
  return vi.fn(
    async () =>
      new Response(chunks.join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  ) as unknown as typeof fetch
}

export const WORKING_CONFIG = {
  providers: [
    {
      id: 'prov-1',
      type: 'openai-compatible',
      displayName: 'Local',
      apiKey: 'k',
      endpoint: 'http://x/v1',
      favoriteModelIds: [],
    },
  ],
  profiles: [
    {
      id: 'np',
      kind: 'narrative',
      name: 'Narrative',
      modelRef: { providerId: 'prov-1', modelId: 'm' },
    },
  ],
  assignments: { classifier: 'np' },
  defaultProviderId: 'prov-1',
  diagnostics: { enabled: false, debug_level_enabled: false },
}

export const STORY_DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

export const STORY_SETTINGS = storySettingsSchema.parse({
  classifierCadence: 8,
  piggybackMode: 'off',
  embeddingBackend: 'local',
  // A catalog id, not a placeholder: the retrieval phase resolves this story's
  // embedder config and blocks the turn when it can't (model-management.md →
  // Embed failure is blocking).
  embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
  retrievalBudgets: { entities: 1, lore: 1, happenings: 1, threads: 1, chapters: 1 },
  composerModesEnabled: true,
  composerWrapPov: 'first',
  suggestionsEnabled: false,
  suggestionCategories: [],
  translation: {
    enabled: false,
    targetLanguage: null,
    granularToggles: {
      narrative: false,
      entityNames: false,
      entityDescriptions: false,
      lore: false,
      threads: false,
      happenings: false,
      chapterMeta: false,
    },
  },
  models: {},
  activePackId: 'pack_bundled_default',
  packVariables: {},
})

// narrativePhase (per-turn.ts) reads the open story from currentStoryStore, not
// from the run's own storyId/branchId — mirrors the real app opening a story
// before the composer can submit a turn. storiesStore is populated from the same
// committed row because the retrieval phase resolves the embedder config there.
export async function openStory(
  db: Awaited<ReturnType<typeof makeHarness>>['db'],
  storyId: string,
  branchId: string,
): Promise<void> {
  await db
    .update(stories)
    .set({ definition: STORY_DEFINITION, settings: STORY_SETTINGS })
    .where(eq(stories.id, storyId))
  await rehydrateStories(db)
  currentStoryStore.set({
    storyId,
    branchId,
    definition: STORY_DEFINITION,
    settings: STORY_SETTINGS,
  })
  // The real open action loads both working sets in one block, and the
  // generation context guards on the entities half being loaded for the branch.
  entitiesStore.hydrate(branchId, [])
}

export function branchEntries(branchId: string) {
  return [...entriesStore.getEntries().values()].filter((e) => e.branchId === branchId)
}
