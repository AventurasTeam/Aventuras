/**
 * Database Mock for E2E Tests
 *
 * Provides a vi.fn()-based mock of the DatabaseService singleton.
 * Methods reachable from the GenerationPipeline are given sensible defaults;
 * all other methods are no-op stubs that can be overridden per test.
 */

import { vi } from 'vitest'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates'
import type { PackTemplate } from '$lib/services/packs/types'

/** Build a PackTemplate[] from the built-in PROMPT_TEMPLATES constant. */
function buildDefaultPackTemplates(): PackTemplate[] {
  const now = Date.now()
  const templates: PackTemplate[] = []
  let counter = 0

  for (const t of PROMPT_TEMPLATES) {
    templates.push({
      id: `pt-${counter++}`,
      packId: 'default-pack',
      templateId: t.id,
      content: t.content,
      contentHash: '',
      createdAt: now,
      updatedAt: now,
    })
    if (t.userContent) {
      templates.push({
        id: `pt-${counter++}`,
        packId: 'default-pack',
        templateId: `${t.id}-user`,
        content: t.userContent,
        contentHash: '',
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return templates
}

let entryCounter = 0

/**
 * Create a fresh database mock. Call in beforeEach to get isolated state.
 */
export function createDatabaseMock() {
  entryCounter = 0
  const defaultTemplates = buildDefaultPackTemplates()

  return {
    // ---- Methods reachable from the pipeline / store operations ----

    // Pack / template system (used by ContextBuilder)
    getStoryPackId: vi.fn().mockResolvedValue('default-pack'),
    getPackTemplates: vi.fn().mockResolvedValue(defaultTemplates),
    getPackVariables: vi.fn().mockResolvedValue([]),

    // Embedded images
    getEmbeddedImagesForStory: vi.fn().mockResolvedValue([]),

    // Story entries (used by story.entry.addEntry / updateEntry)
    getNextEntryPosition: vi.fn().mockImplementation(() => {
      return Promise.resolve(entryCounter++)
    }),
    addStoryEntry: vi.fn().mockImplementation((entry: any) => {
      return Promise.resolve({
        ...entry,
        createdAt: Date.now(),
      })
    }),
    updateStoryEntry: vi.fn().mockResolvedValue(undefined),
    deleteStoryEntry: vi.fn().mockResolvedValue(undefined),
    getStoryEntry: vi.fn().mockResolvedValue(null),
    deleteStoryEntries: vi.fn().mockResolvedValue(undefined),
    clearStoryEntries: vi.fn().mockResolvedValue(undefined),
    getStoryEntries: vi.fn().mockResolvedValue([]),
    getStoryEntriesForBranch: vi.fn().mockResolvedValue([]),
    getStoryEntryCount: vi.fn().mockResolvedValue(0),
    getRecentStoryEntries: vi.fn().mockResolvedValue([]),
    bulkInsertStoryEntries: vi.fn().mockResolvedValue(undefined),

    // Story CRUD
    getStory: vi.fn().mockResolvedValue(null),
    getAllStories: vi.fn().mockResolvedValue([]),
    createStory: vi.fn().mockImplementation((s: any) => {
      return Promise.resolve({ ...s, createdAt: Date.now(), updatedAt: Date.now() })
    }),
    updateStory: vi.fn().mockResolvedValue(undefined),
    deleteStory: vi.fn().mockResolvedValue(undefined),

    // Characters
    getCharacters: vi.fn().mockResolvedValue([]),
    getCharactersForBranch: vi.fn().mockResolvedValue([]),
    addCharacter: vi.fn().mockResolvedValue(undefined),
    updateCharacter: vi.fn().mockResolvedValue(undefined),
    deleteCharacter: vi.fn().mockResolvedValue(undefined),

    // Locations
    getLocations: vi.fn().mockResolvedValue([]),
    getLocationsForBranch: vi.fn().mockResolvedValue([]),
    addLocation: vi.fn().mockResolvedValue(undefined),
    updateLocation: vi.fn().mockResolvedValue(undefined),
    setCurrentLocation: vi.fn().mockResolvedValue(undefined),
    deleteLocation: vi.fn().mockResolvedValue(undefined),

    // Items
    getItems: vi.fn().mockResolvedValue([]),
    getItemsForBranch: vi.fn().mockResolvedValue([]),
    addItem: vi.fn().mockResolvedValue(undefined),
    updateItem: vi.fn().mockResolvedValue(undefined),
    deleteItem: vi.fn().mockResolvedValue(undefined),

    // Story beats
    getStoryBeats: vi.fn().mockResolvedValue([]),
    getStoryBeatsForBranch: vi.fn().mockResolvedValue([]),
    addStoryBeat: vi.fn().mockResolvedValue(undefined),
    updateStoryBeat: vi.fn().mockResolvedValue(undefined),
    deleteStoryBeat: vi.fn().mockResolvedValue(undefined),

    // Chapters
    getChapters: vi.fn().mockResolvedValue([]),
    getChaptersForBranch: vi.fn().mockResolvedValue([]),
    getChapter: vi.fn().mockResolvedValue(null),
    getNextChapterNumber: vi.fn().mockResolvedValue(1),
    addChapter: vi.fn().mockResolvedValue(undefined),
    updateChapter: vi.fn().mockResolvedValue(undefined),
    deleteChapter: vi.fn().mockResolvedValue(undefined),

    // Settings
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    deleteSetting: vi.fn().mockResolvedValue(undefined),
    getAllSettings: vi.fn().mockResolvedValue({}),

    // Retry state
    saveRetryState: vi.fn().mockResolvedValue(undefined),
    clearRetryState: vi.fn().mockResolvedValue(undefined),
    saveStyleReviewState: vi.fn().mockResolvedValue(undefined),
    clearStyleReviewState: vi.fn().mockResolvedValue(undefined),
    saveTimeTracker: vi.fn().mockResolvedValue(undefined),
    clearTimeTracker: vi.fn().mockResolvedValue(undefined),

    // World state snapshots
    createWorldStateSnapshot: vi.fn().mockResolvedValue(undefined),
    getWorldStateSnapshots: vi.fn().mockResolvedValue([]),
    getLatestSnapshotBefore: vi.fn().mockResolvedValue(null),
    deleteWorldStateSnapshotsAfter: vi.fn().mockResolvedValue(undefined),
    deleteWorldStateSnapshotsForBranch: vi.fn().mockResolvedValue(undefined),
    deleteWorldStateSnapshotsForStory: vi.fn().mockResolvedValue(undefined),
    restoreRetryBackup: vi.fn().mockResolvedValue(undefined),
    resetWorldStateForImport: vi.fn().mockResolvedValue(undefined),

    // Checkpoints
    getCheckpoints: vi.fn().mockResolvedValue([]),
    getCheckpoint: vi.fn().mockResolvedValue(null),
    createCheckpoint: vi.fn().mockResolvedValue(undefined),
    deleteCheckpoint: vi.fn().mockResolvedValue(undefined),
    restoreCheckpoint: vi.fn().mockResolvedValue(undefined),

    // Branches
    getBranches: vi.fn().mockResolvedValue([]),
    getBranch: vi.fn().mockResolvedValue(null),
    addBranch: vi.fn().mockResolvedValue(undefined),
    updateBranch: vi.fn().mockResolvedValue(undefined),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    setStoryCurrentBranch: vi.fn().mockResolvedValue(undefined),

    // Embedded images (additional methods)
    createEmbeddedImage: vi.fn().mockResolvedValue(undefined),
    deleteEmbeddedImage: vi.fn().mockResolvedValue(undefined),
    deleteEmbeddedImagesForEntry: vi.fn().mockResolvedValue(undefined),
    getEmbeddedImage: vi.fn().mockResolvedValue(null),
    getEmbeddedImagesForEntry: vi.fn().mockResolvedValue([]),
    updateEmbeddedImage: vi.fn().mockResolvedValue(undefined),

    // Pack / template system (additional methods)
    getDefaultPack: vi.fn().mockResolvedValue({
      id: 'default-pack',
      name: 'Default',
      description: 'Test default pack',
      author: 'Test',
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    createPack: vi.fn().mockImplementation((p: any) => {
      return Promise.resolve({ ...p, createdAt: Date.now(), updatedAt: Date.now() })
    }),
    getPackTemplate: vi.fn().mockImplementation((packId: string, templateId: string) => {
      const found = defaultTemplates.find((t) => t.packId === packId && t.templateId === templateId)
      return Promise.resolve(found ?? null)
    }),
    setPackTemplateContent: vi.fn().mockResolvedValue(undefined),
    setStoryPack: vi.fn().mockResolvedValue(undefined),
    getStoryCustomVariables: vi.fn().mockResolvedValue(null),
    setStoryCustomVariables: vi.fn().mockResolvedValue(undefined),
    getRuntimeVariables: vi.fn().mockResolvedValue([]),
    getRuntimeVariableValues: vi.fn().mockResolvedValue({}),

    // Lorebook
    getLorebookEntries: vi.fn().mockResolvedValue([]),
    addLorebookEntry: vi.fn().mockResolvedValue(undefined),
    updateLorebookEntry: vi.fn().mockResolvedValue(undefined),
    deleteLorebookEntry: vi.fn().mockResolvedValue(undefined),

    // Misc
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    rawQuery: vi.fn().mockResolvedValue([]),
    vacuumInto: vi.fn().mockResolvedValue(undefined),

    // Vault
    getVaultCharacters: vi.fn().mockResolvedValue([]),
    addVaultCharacter: vi.fn().mockResolvedValue(undefined),
    updateVaultCharacter: vi.fn().mockResolvedValue(undefined),
    deleteVaultCharacter: vi.fn().mockResolvedValue(undefined),
  }
}

export type DatabaseMock = ReturnType<typeof createDatabaseMock>
