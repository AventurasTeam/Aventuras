import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { database } from './database'
import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  Entry,
  Checkpoint,
  Branch,
  PersistentStyleReviewState,
  EmbeddedImage,
} from '$lib/types'

export interface AventuraExport {
  version: string
  exportedAt: number
  story: Story
  entries: StoryEntry[]
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  lorebookEntries?: Entry[] // Added in v1.1.0
  styleReviewState?: PersistentStyleReviewState | null // Added in v1.2.0
  // Note: story.timeTracker added in v1.3.0
  embeddedImages?: EmbeddedImage[] // Added in v1.4.0
  checkpoints?: Checkpoint[] // Added in v1.6.0
  branches?: Branch[] // Added in v1.6.0
  chapters?: Chapter[] // Added in v1.7.0
  currentBgImage?: string | null // Added in v1.8.0
}

// Version history for import compatibility
// v1.0.0 - Initial release
// v1.1.0 - Added lorebookEntries
// v1.2.0 - Added styleReviewState
// v1.3.0 - Added timeTracker to story, entry metadata (timeStart/timeEnd)
// v1.4.0 - Added embeddedImages (generated images embedded in story entries)
// v1.5.0 - Added character portraits
// v1.6.0 - Added checkpoints and branches
// v1.7.0 - Added chapters (memory system)

class ExportService {
  private readonly VERSION = '1.7.0'

  /**
   * Compare semantic versions. Returns:
   * - negative if a < b
   * - 0 if a === b
   * - positive if a > b
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number)
    const partsB = b.split('.').map(Number)
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] ?? 0
      const partB = partsB[i] ?? 0
      if (partA !== partB) return partA - partB
    }
    return 0
  }

  /**
   * Log warnings for imports from older versions that may be missing features.
   */
  private logVersionCompatibilityWarnings(importVersion: string): void {
    if (this.compareVersions(importVersion, '1.1.0') < 0) {
      console.warn(
        `[Import] File from v${importVersion} predates lorebook entries (v1.1.0). Lorebook will be empty.`,
      )
    }
    if (this.compareVersions(importVersion, '1.2.0') < 0) {
      console.warn(
        `[Import] File from v${importVersion} predates style review state (v1.2.0). Style analysis history will be empty.`,
      )
    }
    if (this.compareVersions(importVersion, '1.3.0') < 0) {
      console.warn(
        `[Import] File from v${importVersion} predates time tracking (v1.3.0). Time tracker will start at zero.`,
      )
    }
    if (this.compareVersions(importVersion, '1.4.0') < 0) {
      console.warn(
        `[Import] File from v${importVersion} predates embedded images (v1.4.0). Generated images will not be restored.`,
      )
    }
    if (this.compareVersions(importVersion, '1.5.0') < 0) {
      console.warn(
        `[Import] File from v${importVersion} predates character portraits (v1.5.0). Character portraits will not be restored.`,
      )
    }
    if (this.compareVersions(importVersion, '1.6.0') < 0) {
      console.warn(
        `[Import] File from v${importVersion} predates branching data (v1.6.0). Branches and checkpoints will not be restored.`,
      )
    }
    if (this.compareVersions(importVersion, '1.7.0') < 0) {
      console.warn(
        `[Import] File from v${importVersion} predates chapters (v1.7.0). Chapter summaries (memory) will not be restored.`,
      )
    }
    if (this.compareVersions(importVersion, '1.8.0') < 0) {
      console.warn(
        `[Import] File from v${importVersion} predates current background image (v1.8.0). Current background image will not be restored.`,
      )
    }
  }

  // Export to Aventura format (.avt - JSON)
  async exportToAventura(
    story: Story,
    entries: StoryEntry[],
    characters: Character[],
    locations: Location[],
    items: Item[],
    storyBeats: StoryBeat[],
    lorebookEntries: Entry[] = [],
    embeddedImages: EmbeddedImage[] = [],
    checkpoints: Checkpoint[] = [],
    branches: Branch[] = [],
    chapters: Chapter[] = [],
    currentBgImage: string | null = null,
  ): Promise<boolean> {
    const exportData: AventuraExport = {
      version: this.VERSION,
      exportedAt: Date.now(),
      story,
      entries,
      characters,
      locations,
      items,
      storyBeats,
      lorebookEntries,
      styleReviewState: story.styleReviewState,
      embeddedImages,
      checkpoints,
      branches,
      chapters,
      currentBgImage,
    }

    const filePath = await save({
      defaultPath: `${this.sanitizeFilename(story.title)}.avt`,
      filters: [
        { name: 'Aventura Story', extensions: ['avt'] },
        { name: 'JSON', extensions: ['json'] },
      ],
    })

    if (!filePath) return false

    await writeTextFile(filePath, JSON.stringify(exportData, null, 2))
    return true
  }

  // Export to Markdown
  async exportToMarkdown(
    story: Story,
    entries: StoryEntry[],
    characters: Character[],
    locations: Location[],
    includeWorldState: boolean = false,
  ): Promise<boolean> {
    let markdown = `# ${story.title}\n\n`

    if (story.description) {
      markdown += `*${story.description}*\n\n`
    }

    if (story.genre) {
      markdown += `**Genre:** ${story.genre}\n\n`
    }

    markdown += `---\n\n`

    // Add story entries (use translated content when available)
    for (const entry of entries) {
      if (entry.type === 'user_action') {
        // For user actions, show original input if translation was used, otherwise show content
        const displayContent = entry.originalInput ?? entry.content
        markdown += `> **You:** ${displayContent}\n\n`
      } else if (entry.type === 'narration') {
        // For narration, use translated content if available
        const displayContent = entry.translatedContent ?? entry.content
        markdown += `${displayContent}\n\n`
      } else if (entry.type === 'system') {
        markdown += `*[System: ${entry.content}]*\n\n`
      }
    }

    // Optionally include world state
    if (includeWorldState) {
      markdown += `---\n\n## World State\n\n`

      if (characters.length > 0) {
        markdown += `### Characters\n\n`
        for (const char of characters) {
          markdown += `- **${char.name}**`
          if (char.relationship) markdown += ` (${char.relationship})`
          if (char.description) markdown += `: ${char.description}`
          markdown += `\n`
        }
        markdown += `\n`
      }

      if (locations.length > 0) {
        markdown += `### Locations\n\n`
        for (const loc of locations) {
          markdown += `- **${loc.name}**`
          if (loc.current) markdown += ` [Current]`
          if (loc.visited) markdown += ` [Visited]`
          if (loc.description) markdown += `: ${loc.description}`
          markdown += `\n`
        }
        markdown += `\n`
      }
    }

    // Add export metadata
    markdown += `---\n\n`
    markdown += `*Exported from Aventura on ${new Date().toLocaleDateString()}*\n`

    const filePath = await save({
      defaultPath: `${this.sanitizeFilename(story.title)}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    })

    if (!filePath) return false

    await writeTextFile(filePath, markdown)
    return true
  }

  // Export to plain text
  async exportToText(story: Story, entries: StoryEntry[]): Promise<boolean> {
    let text = `${story.title}\n${'='.repeat(story.title.length)}\n\n`

    if (story.description) {
      text += `${story.description}\n\n`
    }

    text += `---\n\n`

    // Use translated content when available
    for (const entry of entries) {
      if (entry.type === 'user_action') {
        // For user actions, show original input if translation was used
        const displayContent = entry.originalInput ?? entry.content
        text += `> ${displayContent}\n\n`
      } else if (entry.type === 'narration') {
        // For narration, use translated content if available
        const displayContent = entry.translatedContent ?? entry.content
        text += `${displayContent}\n\n`
      }
    }

    const filePath = await save({
      defaultPath: `${this.sanitizeFilename(story.title)}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    })

    if (!filePath) return false

    await writeTextFile(filePath, text)
    return true
  }

  // Import from Aventura format (.avt) - uses native file dialog (desktop)
  async importFromAventura(): Promise<{ success: boolean; storyId?: string; error?: string }> {
    const filePath = await open({
      filters: [
        { name: 'Aventura Story', extensions: ['avt'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }, // Fallback for Android compatibility
      ],
    })

    if (!filePath || typeof filePath !== 'string') {
      return { success: false }
    }

    try {
      const content = await readTextFile(filePath)
      return this.importFromContent(content)
    } catch (error) {
      console.error('Import failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import file',
      }
    }
  }

  // Import from file content string (for HTML file input / mobile compatibility)
  // Set skipImportedSuffix to true for sync operations to keep the original title
  async importFromContent(
    content: string,
    skipImportedSuffix: boolean = false,
  ): Promise<{ success: boolean; storyId?: string; error?: string }> {
    try {
      let data: AventuraExport
      try {
        data = JSON.parse(content)
      } catch {
        return {
          success: false,
          error:
            'Invalid file: Not a valid JSON file. Please select an Aventura story file (.avt or .json).',
        }
      }

      // Validate the import data
      if (!data.version || !data.story || !data.entries) {
        return {
          success: false,
          error:
            'Invalid file format: This does not appear to be an Aventura story file. Missing required fields (version, story, or entries).',
        }
      }

      if (data.entries.length === 0) {
        return { success: false, error: 'Invalid story file: The file contains no story entries.' }
      }

      // Log warnings for older export versions that may be missing newer features
      this.logVersionCompatibilityWarnings(data.version)

      // Generate new IDs to avoid conflicts
      const oldToNewId = new Map<string, string>()
      const branchIdMap = new Map<string, string>()
      const checkpointIdMap = new Map<string, string>()

      // Create new story ID
      const newStoryId = crypto.randomUUID()
      oldToNewId.set(data.story.id, newStoryId)

      // Pre-map entry IDs (branches can reference fork entries)
      for (const entry of data.entries) {
        oldToNewId.set(entry.id, crypto.randomUUID())
      }

      // Pre-map world-state entity IDs so that COW overridesId references can be
      // resolved during import (override rows reference the original entity's old ID).
      for (const collection of [
        data.characters,
        data.locations,
        data.items,
        data.storyBeats,
        data.lorebookEntries,
      ]) {
        for (const entity of collection ?? []) {
          oldToNewId.set(entity.id, crypto.randomUUID())
        }
      }

      // Pre-map branch/checkpoint IDs if present
      if (data.branches) {
        for (const branch of data.branches) {
          branchIdMap.set(branch.id, crypto.randomUUID())
        }
      }
      if (data.checkpoints) {
        for (const checkpoint of data.checkpoints) {
          checkpointIdMap.set(checkpoint.id, crypto.randomUUID())
        }
      }

      // Create the story with a modified title to indicate it was imported (unless skipped for sync)
      const importedStory: Omit<Story, 'createdAt' | 'updatedAt'> = {
        id: newStoryId,
        title: skipImportedSuffix ? data.story.title : `${data.story.title} (Imported)`,
        description: data.story.description,
        genre: data.story.genre,
        templateId: data.story.templateId,
        mode: data.story.mode || 'adventure',
        settings: data.story.settings,
        memoryConfig: data.story.memoryConfig || null,
        retryState: null, // Clear retry state on import
        styleReviewState: data.styleReviewState ?? null, // Restore style review state from export (v1.2.0+)
        timeTracker: data.story.timeTracker ?? null, // Restore time tracker from export
        currentBranchId: null, // Set after branch import (if available)
        currentBgImage: data.story.currentBgImage || null,
      }

      await database.createStory(importedStory)

      const mapBranchId = (branchId: string | null | undefined) =>
        branchId ? (branchIdMap.get(branchId) ?? null) : null
      const mapEntryId = (entryId: string | null | undefined) =>
        entryId ? (oldToNewId.get(entryId) ?? entryId) : null
      // For COW overridesId: resolve to new UUID or null (never keep the old ID)
      const mapOverridesId = (id: string | null | undefined) =>
        id ? (oldToNewId.get(id) ?? null) : null

      // Import branches (insert parents before children)
      const branchCheckpointMap = new Map<string, string | null>()
      if (data.branches && data.branches.length > 0) {
        const insertBranch = async (branch: Branch, parentBranchId: string | null) => {
          const newBranchId = branchIdMap.get(branch.id)
          if (!newBranchId) return
          await database.addBranch({
            id: newBranchId,
            storyId: newStoryId,
            name: branch.name,
            parentBranchId,
            forkEntryId: mapEntryId(branch.forkEntryId) ?? branch.forkEntryId,
            checkpointId: null,
            createdAt: branch.createdAt,
            snapshotComplete: branch.snapshotComplete ?? false,
          })
          const mappedCheckpointId = branch.checkpointId
            ? (checkpointIdMap.get(branch.checkpointId) ?? null)
            : null
          branchCheckpointMap.set(newBranchId, mappedCheckpointId)
        }

        const pending = [...data.branches]
        const inserted = new Set<string>()
        let progress = true

        while (pending.length > 0 && progress) {
          progress = false
          for (let i = pending.length - 1; i >= 0; i--) {
            const branch = pending[i]
            const newBranchId = branchIdMap.get(branch.id)
            if (!newBranchId) {
              pending.splice(i, 1)
              continue
            }

            const mappedParentId = branch.parentBranchId
              ? (branchIdMap.get(branch.parentBranchId) ?? null)
              : null
            if (mappedParentId && !inserted.has(mappedParentId)) {
              continue
            }

            await insertBranch(branch, mappedParentId)
            inserted.add(newBranchId)
            pending.splice(i, 1)
            progress = true
          }
        }

        // If any branches remain, insert them with no parent to avoid FK errors
        for (const branch of pending) {
          await insertBranch(branch, null)
        }
      }

      // Import entries
      for (const entry of data.entries) {
        const newEntryId = oldToNewId.get(entry.id) ?? crypto.randomUUID()

        await database.addStoryEntry({
          id: newEntryId,
          storyId: newStoryId,
          type: entry.type,
          content: entry.content,
          parentId: entry.parentId ? (oldToNewId.get(entry.parentId) ?? null) : null,
          position: entry.position,
          metadata: entry.metadata,
          branchId: mapBranchId(entry.branchId ?? null),
          // Translation fields
          translatedContent: entry.translatedContent ?? null,
          translationLanguage: entry.translationLanguage ?? null,
          originalInput: entry.originalInput ?? null,
        })
      }

      // Import characters
      if (data.characters) {
        for (const char of data.characters) {
          const newCharId = oldToNewId.get(char.id) ?? crypto.randomUUID()

          await database.addCharacter({
            id: newCharId,
            storyId: newStoryId,
            name: char.name,
            description: char.description,
            relationship: char.relationship,
            traits: char.traits,
            status: char.status,
            metadata: char.metadata,
            visualDescriptors: char.visualDescriptors ?? {},
            portrait: char.portrait ?? null,
            branchId: mapBranchId(char.branchId ?? null),
            overridesId: mapOverridesId(char.overridesId),
            deleted: char.deleted ?? false,
            // Translation fields
            translatedName: char.translatedName ?? null,
            translatedDescription: char.translatedDescription ?? null,
            translatedRelationship: char.translatedRelationship ?? null,
            translatedTraits: char.translatedTraits ?? null,
            translatedVisualDescriptors: char.translatedVisualDescriptors ?? null,
            translationLanguage: char.translationLanguage ?? null,
          })
        }
      }

      // Import locations
      if (data.locations) {
        for (const loc of data.locations) {
          const newLocId = oldToNewId.get(loc.id) ?? crypto.randomUUID()

          await database.addLocation({
            id: newLocId,
            storyId: newStoryId,
            name: loc.name,
            description: loc.description,
            visited: loc.visited,
            current: loc.current,
            connections: loc.connections.map((c) => oldToNewId.get(c) ?? c),
            metadata: loc.metadata,
            branchId: mapBranchId(loc.branchId ?? null),
            overridesId: mapOverridesId(loc.overridesId),
            deleted: loc.deleted ?? false,
            // Translation fields
            translatedName: loc.translatedName ?? null,
            translatedDescription: loc.translatedDescription ?? null,
            translationLanguage: loc.translationLanguage ?? null,
          })
        }
      }

      // Import items
      if (data.items) {
        for (const item of data.items) {
          const newItemId = oldToNewId.get(item.id) ?? crypto.randomUUID()

          const mappedLocation =
            item.location === 'inventory'
              ? 'inventory'
              : (oldToNewId.get(item.location) ?? item.location)

          await database.addItem({
            id: newItemId,
            storyId: newStoryId,
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            equipped: item.equipped,
            location: mappedLocation,
            metadata: item.metadata,
            branchId: mapBranchId(item.branchId ?? null),
            overridesId: mapOverridesId(item.overridesId),
            deleted: item.deleted ?? false,
            // Translation fields
            translatedName: item.translatedName ?? null,
            translatedDescription: item.translatedDescription ?? null,
            translationLanguage: item.translationLanguage ?? null,
          })
        }
      }

      // Import story beats
      if (data.storyBeats) {
        for (const beat of data.storyBeats) {
          const newBeatId = oldToNewId.get(beat.id) ?? crypto.randomUUID()

          await database.addStoryBeat({
            id: newBeatId,
            storyId: newStoryId,
            title: beat.title,
            description: beat.description,
            type: beat.type,
            status: beat.status,
            triggeredAt: beat.triggeredAt,
            resolvedAt: beat.resolvedAt ?? null,
            metadata: beat.metadata,
            branchId: mapBranchId(beat.branchId ?? null),
            overridesId: mapOverridesId(beat.overridesId),
            deleted: beat.deleted ?? false,
            // Translation fields
            translatedTitle: beat.translatedTitle ?? null,
            translatedDescription: beat.translatedDescription ?? null,
            translationLanguage: beat.translationLanguage ?? null,
          })
        }
      }

      // Import lorebook entries (added in v1.1.0)
      if (data.lorebookEntries) {
        for (const entry of data.lorebookEntries) {
          const newEntryId = oldToNewId.get(entry.id) ?? crypto.randomUUID()

          await database.addEntry({
            id: newEntryId,
            storyId: newStoryId,
            name: entry.name,
            type: entry.type,
            description: entry.description,
            hiddenInfo: entry.hiddenInfo,
            aliases: entry.aliases || [],
            state: entry.state,
            adventureState: entry.adventureState,
            creativeState: entry.creativeState,
            injection: entry.injection,
            firstMentioned: entry.firstMentioned
              ? (oldToNewId.get(entry.firstMentioned) ?? entry.firstMentioned)
              : null,
            lastMentioned: entry.lastMentioned
              ? (oldToNewId.get(entry.lastMentioned) ?? entry.lastMentioned)
              : null,
            mentionCount: entry.mentionCount || 0,
            createdBy: entry.createdBy || 'import',
            createdAt: entry.createdAt || Date.now(),
            updatedAt: Date.now(),
            loreManagementBlacklisted: entry.loreManagementBlacklisted || false,
            branchId: mapBranchId(entry.branchId ?? null),
            overridesId: mapOverridesId(entry.overridesId),
            deleted: entry.deleted ?? false,
          })
        }
      }

      // Import checkpoints (added in v1.6.0)
      if (data.checkpoints) {
        const remapEntityId = (id: string) => oldToNewId.get(id) ?? id
        const remapStoryEntry = (entry: StoryEntry): StoryEntry => ({
          ...entry,
          id: remapEntityId(entry.id),
          storyId: newStoryId,
          parentId: entry.parentId ? (remapEntityId(entry.parentId) ?? entry.parentId) : null,
          branchId: mapBranchId(entry.branchId ?? null),
        })
        const remapCharacter = (char: Character): Character => ({
          ...char,
          id: remapEntityId(char.id),
          storyId: newStoryId,
          branchId: mapBranchId(char.branchId ?? null),
        })
        const remapLocation = (loc: Location): Location => ({
          ...loc,
          id: remapEntityId(loc.id),
          storyId: newStoryId,
          branchId: mapBranchId(loc.branchId ?? null),
          connections: loc.connections.map((id) => oldToNewId.get(id) ?? id),
        })
        const remapItem = (item: Item): Item => ({
          ...item,
          id: remapEntityId(item.id),
          storyId: newStoryId,
          branchId: mapBranchId(item.branchId ?? null),
          location:
            item.location === 'inventory'
              ? 'inventory'
              : (oldToNewId.get(item.location) ?? item.location),
        })
        const remapStoryBeat = (beat: StoryBeat): StoryBeat => ({
          ...beat,
          id: remapEntityId(beat.id),
          storyId: newStoryId,
          branchId: mapBranchId(beat.branchId ?? null),
        })
        const remapChapter = (chapter: Chapter): Chapter => ({
          ...chapter,
          id: remapEntityId(chapter.id),
          storyId: newStoryId,
          startEntryId: remapEntityId(chapter.startEntryId),
          endEntryId: remapEntityId(chapter.endEntryId),
          branchId: mapBranchId(chapter.branchId ?? null),
        })
        const remapLorebookEntry = (entry: Entry): Entry => ({
          ...entry,
          id: remapEntityId(entry.id),
          storyId: newStoryId,
          branchId: mapBranchId(entry.branchId ?? null),
          firstMentioned: entry.firstMentioned
            ? (oldToNewId.get(entry.firstMentioned) ?? entry.firstMentioned)
            : null,
          lastMentioned: entry.lastMentioned
            ? (oldToNewId.get(entry.lastMentioned) ?? entry.lastMentioned)
            : null,
        })

        for (const checkpoint of data.checkpoints) {
          const newCheckpointId = checkpointIdMap.get(checkpoint.id) ?? crypto.randomUUID()
          checkpointIdMap.set(checkpoint.id, newCheckpointId)

          await database.createCheckpoint({
            id: newCheckpointId,
            storyId: newStoryId,
            name: checkpoint.name,
            lastEntryId: remapEntityId(checkpoint.lastEntryId),
            lastEntryPreview: checkpoint.lastEntryPreview,
            entryCount: checkpoint.entryCount,
            entriesSnapshot: checkpoint.entriesSnapshot.map(remapStoryEntry),
            charactersSnapshot: checkpoint.charactersSnapshot.map(remapCharacter),
            locationsSnapshot: checkpoint.locationsSnapshot.map(remapLocation),
            itemsSnapshot: checkpoint.itemsSnapshot.map(remapItem),
            storyBeatsSnapshot: checkpoint.storyBeatsSnapshot.map(remapStoryBeat),
            chaptersSnapshot: checkpoint.chaptersSnapshot.map(remapChapter),
            timeTrackerSnapshot: checkpoint.timeTrackerSnapshot,
            lorebookEntriesSnapshot: checkpoint.lorebookEntriesSnapshot
              ? checkpoint.lorebookEntriesSnapshot.map(remapLorebookEntry)
              : undefined,
            createdAt: checkpoint.createdAt ?? Date.now(),
          })
        }
      }

      // Update branch checkpoint references (after checkpoints exist)
      if (branchCheckpointMap.size > 0) {
        for (const [branchId, checkpointId] of branchCheckpointMap.entries()) {
          if (checkpointId) {
            await database.updateBranch(branchId, { checkpointId })
          }
        }
      }

      // Restore current branch if available
      if (data.story.currentBranchId) {
        const mappedCurrentBranch = branchIdMap.get(data.story.currentBranchId) ?? null
        if (mappedCurrentBranch) {
          await database.setStoryCurrentBranch(newStoryId, mappedCurrentBranch)
        }
      }

      // Import chapters (added in v1.7.0)
      if (data.chapters) {
        for (const chapter of data.chapters) {
          const newChapterId = crypto.randomUUID()
          oldToNewId.set(chapter.id, newChapterId)

          await database.addChapter({
            id: newChapterId,
            storyId: newStoryId,
            number: chapter.number,
            title: chapter.title,
            startEntryId: oldToNewId.get(chapter.startEntryId) ?? chapter.startEntryId,
            endEntryId: oldToNewId.get(chapter.endEntryId) ?? chapter.endEntryId,
            entryCount: chapter.entryCount,
            summary: chapter.summary,
            startTime: chapter.startTime,
            endTime: chapter.endTime,
            keywords: chapter.keywords,
            characters: chapter.characters,
            locations: chapter.locations,
            plotThreads: chapter.plotThreads,
            emotionalTone: chapter.emotionalTone,
            branchId: chapter.branchId ? (branchIdMap.get(chapter.branchId) ?? null) : null,
            createdAt: chapter.createdAt,
          })
        }
      }

      // Import embedded images (added in v1.4.0)
      if (data.embeddedImages) {
        for (const image of data.embeddedImages) {
          const newImageId = crypto.randomUUID()
          oldToNewId.set(image.id, newImageId)

          // Map the entry ID to the new entry ID
          const newEntryId = oldToNewId.get(image.entryId)
          if (!newEntryId) {
            console.warn(
              `[Import] Skipping embedded image ${image.id}: entry ${image.entryId} not found`,
            )
            continue
          }

          await database.createEmbeddedImage({
            id: newImageId,
            storyId: newStoryId,
            entryId: newEntryId,
            sourceText: image.sourceText,
            prompt: image.prompt,
            styleId: image.styleId,
            model: image.model,
            imageData: image.imageData,
            width: image.width,
            height: image.height,
            status: image.status,
            errorMessage: image.errorMessage,
          })
        }
      }

      return { success: true, storyId: newStoryId }
    } catch (error) {
      console.error('Import failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import file',
      }
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 100)
  }
}

export const exportService = new ExportService()

// Re-export coordination service
export { gatherStoryData, type StoryExportData } from './export/ExportCoordinationService'
