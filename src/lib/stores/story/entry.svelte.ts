import { database } from '$lib/services/database'
import { rollbackService } from '$lib/services/rollbackService'
import type { STChatMessage } from '$lib/services/stChatImporter'
import { countTokens } from '$lib/services/tokenizer'
import type { StoryEntry } from '$lib/types'
import { settings } from '../settings.svelte'
import { ui } from '../ui.svelte'
import type { StoryStore } from './index.svelte'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Entry]', ...args)
  }
}

export class StoryEntryStore {
  constructor(private ctx: StoryStore) {}

  entries = $state<StoryEntry[]>([])

  _entryIdToIndex: Map<string, number> = new Map()

  // Add a new story entry
  // The optional id parameter allows pre-generating the entry ID before streaming starts,
  // which is needed for inline image generation during streaming
  async addEntry(
    type: StoryEntry['type'],
    content: string,
    metadata?: StoryEntry['metadata'],
    reasoning?: string,
    id?: string,
  ): Promise<StoryEntry> {
    if (!this.ctx.currentStory) {
      throw new Error('No story loaded')
    }

    // Count tokens for accurate auto-summarize threshold detection
    const tokenCount = countTokens(content)

    // Capture current story time as timeStart for this entry
    // timeEnd defaults to timeStart; for narration entries, timeEnd is updated after classification
    const timeStart = this.ctx.currentStory.timeTracker
      ? { ...this.ctx.currentStory.timeTracker }
      : { years: 0, days: 0, hours: 0, minutes: 0 }
    const timeEnd = { ...timeStart }

    const position = await database.getNextEntryPosition(
      this.ctx.currentStory.id,
      this.ctx.currentStory.currentBranchId,
    )
    const entry = await database.addStoryEntry({
      id: id ?? crypto.randomUUID(),
      storyId: this.ctx.currentStory.id,
      type,
      content,
      parentId: null,
      position,
      metadata: { ...metadata, tokenCount, timeStart, timeEnd },
      branchId: this.ctx.currentStory.currentBranchId,
      reasoning,
    })

    this.entries = [...this.entries, entry]

    // Invalidate caches
    this.ctx.generationContext.invalidateWordCountCache()
    this.ctx.chapter.invalidateChapterCache()

    // Update story's updatedAt
    await database.updateStory(this.ctx.currentStory.id, {})

    return entry
  }

  // Update a story entry
  async updateEntry(entryId: string, content: string): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    // Prevent editing during any generation or retry restore to avoid race conditions
    // Silently return - UI should disable buttons using ui.isGenerating
    if (this.ctx.retry.isRetryInProgress || ui.isGenerating) {
      log('Edit blocked - generation or retry in progress')
      return
    }

    const existingEntry = this.entries.find((e) => e.id === entryId)
    if (!existingEntry) throw new Error('Entry not found')

    // Prevent modifying inherited entries on a branch
    // An entry is inherited if its branchId doesn't match the current branch
    const currentBranchId = this.ctx.currentStory.currentBranchId
    if ((existingEntry.branchId ?? null) !== currentBranchId) {
      throw new Error(
        'Cannot edit inherited entries. This entry belongs to ' +
          (existingEntry.branchId === null ? 'the main branch' : 'a parent branch') +
          '. Create new content on this branch instead.',
      )
    }

    // Recalculate token count when content changes
    const tokenCount = countTokens(content)
    const updatedMetadata = { ...existingEntry.metadata, tokenCount }

    await database.updateStoryEntry(entryId, { content, metadata: updatedMetadata })
    this.entries = this.entries.map((e) =>
      e.id === entryId ? { ...e, content, metadata: updatedMetadata } : e,
    )

    // Invalidate word count cache (content changed)
    this.ctx.generationContext.invalidateWordCountCache()

    // Update story's updatedAt
    await database.updateStory(this.ctx.currentStory.id, {})
  }

  // Delete a story entry
  async deleteEntry(entryId: string): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    // Prevent deleting during any generation or retry restore to avoid race conditions
    // Silently return - UI should disable buttons using ui.isGenerating
    if (this.ctx.retry.isRetryInProgress || ui.isGenerating) {
      log('Delete blocked - generation or retry in progress')
      return
    }

    const existingEntry = this.entries.find((e) => e.id === entryId)
    if (!existingEntry) throw new Error('Entry not found')

    // Prevent deleting inherited entries on a branch
    // An entry is inherited if its branchId doesn't match the current branch
    const currentBranchId = this.ctx.currentStory.currentBranchId
    if ((existingEntry.branchId ?? null) !== currentBranchId) {
      throw new Error(
        'Cannot delete inherited entries. This entry belongs to ' +
          (existingEntry.branchId === null ? 'the main branch' : 'a parent branch') +
          '. You can only delete entries created on the current branch.',
      )
    }

    // Check if this entry is a fork point for any branch
    const branchUsingEntry = this.ctx.branch.branches.find((b) => b.forkEntryId === entryId)
    if (branchUsingEntry) {
      throw new Error(
        `Cannot delete this entry because it is the fork point for branch "${branchUsingEntry.name}". ` +
          `Delete the branch first if you want to remove this entry.`,
      )
    }

    // Phase 2: Rollback on delete — cascade delete from this position with world state undo
    const rollbackEnabled =
      settings.experimentalFeatures.stateTracking && settings.experimentalFeatures.rollbackOnDelete

    if (rollbackEnabled) {
      log('Rollback-on-delete: cascading from position', existingEntry.position)

      // Run rollback to undo world state changes for this entry and all after it
      const rollbackSummary = await rollbackService.rollbackFromPosition(
        this.ctx.currentStory.id,
        currentBranchId ?? null,
        existingEntry.position,
        this.entries,
      )

      log('Rollback summary:', rollbackSummary)

      // Now cascade-delete entries from this position onward (skip rollback — already done)
      await this.deleteEntriesFromPosition(existingEntry.position, { skipRollback: true })

      // Reload all entities from DB to ensure in-memory state is consistent
      await this.ctx.branch.reloadEntriesForCurrentBranch()

      // Also reload time tracker from the story record
      const freshStory = await database.getStory(this.ctx.currentStory.id)
      if (freshStory) {
        this.ctx.currentStory = {
          ...this.ctx.currentStory,
          timeTracker: freshStory.timeTracker,
        }
      }

      // Restore suggested actions from the new last narration entry
      this.ctx.restoreSuggestedActionsAfterDelete()

      return
    }

    // Legacy behavior: delete just this one entry (no world state changes)
    await database.deleteStoryEntry(entryId)
    this.ctx.entry.entries = this.ctx.entry.entries.filter((e) => e.id !== entryId)

    // Invalidate caches
    this.ctx.generationContext.invalidateWordCountCache()
    this.ctx.chapter.invalidateChapterCache()

    // Update story's updatedAt
    await database.updateStory(this.ctx.currentStory.id, {})

    // Restore suggested actions from the new last narration entry
    this.ctx.restoreSuggestedActionsAfterDelete()
  }

  /**
   * Update an entry's timeEnd metadata after classification applies time progression.
   * Called after applyClassificationResult to record the story time after the entry's events.
   */
  async updateEntryTimeEnd(entryId: string): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    const entry = this.ctx.entry.entries.find((e) => e.id === entryId)
    if (!entry) {
      log('updateEntryTimeEnd: Entry not found', entryId)
      return
    }

    // Capture current story time as timeEnd
    const timeEnd = this.ctx.currentStory.timeTracker
      ? { ...this.ctx.currentStory.timeTracker }
      : { years: 0, days: 0, hours: 0, minutes: 0 }

    const updatedMetadata = { ...entry.metadata, timeEnd }

    await database.updateStoryEntry(entryId, { metadata: updatedMetadata })
    this.ctx.entry.entries = this.ctx.entry.entries.map((e) =>
      e.id === entryId ? { ...e, metadata: updatedMetadata } : e,
    )

    log('Entry timeEnd updated', { entryId, timeEnd })
  }

  /**
   * Update an entry's reasoning content and persist to database.
   */
  async updateEntryReasoning(entryId: string, reasoning: string): Promise<void> {
    const entry = this.ctx.entry.entries.find((e) => e.id === entryId)
    if (!entry) return

    // Update in-memory state
    this.ctx.entry.entries = this.ctx.entry.entries.map((e) =>
      e.id === entryId ? { ...e, reasoning } : e,
    )

    // Persist to database
    await database.updateStoryEntry(entryId, { reasoning })
  }

  /**
   * Refresh a single entry from the database to pick up changes made directly.
   * Used when background processes update entries (e.g., translation).
   */
  async refreshEntry(entryId: string): Promise<void> {
    const updatedEntry = await database.getStoryEntry(entryId)
    if (!updatedEntry) return

    // Update in-memory state
    this.ctx.entry.entries = this.ctx.entry.entries.map((e) =>
      e.id === entryId ? updatedEntry : e,
    )
  }

  /**
   * Delete all entries from a given position onward.
   * Used for entry-only retry restore (persistent retry).
   */
  async deleteEntriesFromPosition(
    position: number,
    options?: { skipRollback?: boolean },
  ): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    // Phase 2: Rollback world state before deleting entries
    // Skip if caller already performed rollback (e.g. deleteEntry)
    const rollbackEnabled =
      !options?.skipRollback &&
      settings.experimentalFeatures.stateTracking &&
      settings.experimentalFeatures.rollbackOnDelete

    if (rollbackEnabled) {
      try {
        const rollbackSummary = await rollbackService.rollbackFromPosition(
          this.ctx.currentStory.id,
          this.ctx.currentStory.currentBranchId ?? null,
          position,
          this.ctx.entry.entries,
        )
        log('Rollback before deleteEntriesFromPosition:', rollbackSummary)
      } catch (error) {
        console.error('[StoryStore] Rollback failed, proceeding with entry deletion:', error)
      }
    }

    // Find entries to delete (position >= the given position)
    const entriesToDelete = this.ctx.entry.entries.filter((e) => e.position >= position)
    const entryIdsToDelete = new Set(entriesToDelete.map((e) => e.id))

    log('Deleting entries from position', {
      position,
      entriesToDelete: entriesToDelete.length,
      totalEntries: this.ctx.entry.entries.length,
    })

    // Find chapters that reference any of the entries being deleted
    // (chapters have foreign keys to start_entry_id and end_entry_id)
    const chaptersToDelete = this.ctx.chapter.chapters.filter(
      (ch) => entryIdsToDelete.has(ch.startEntryId) || entryIdsToDelete.has(ch.endEntryId),
    )

    if (chaptersToDelete.length > 0) {
      log('Deleting chapters that reference entries being deleted', {
        chaptersToDelete: chaptersToDelete.length,
        chapterNumbers: chaptersToDelete.map((ch) => ch.number),
      })

      // Delete chapters first (to satisfy foreign key constraints)
      for (const chapter of chaptersToDelete) {
        await database.deleteChapter(chapter.id)
      }
      this.ctx.chapter.chapters = this.ctx.chapter.chapters.filter(
        (ch) => !chaptersToDelete.some((d) => d.id === ch.id),
      )
    }

    // Delete embedded images for entries being deleted
    // (explicit deletion to ensure cleanup even if CASCADE isn't working)
    for (const entry of entriesToDelete) {
      await database.deleteEmbeddedImagesForEntry(entry.id)
    }

    // Now delete entries from database
    if (entriesToDelete.length > 0) {
      await database.deleteStoryEntries(Array.from(entryIdsToDelete))
    }

    // Update in-memory state
    this.ctx.entry.entries = this.ctx.entry.entries.filter((e) => e.position < position)

    // Invalidate caches
    this.ctx.generationContext.invalidateWordCountCache()
    this.ctx.chapter.invalidateChapterCache()

    // Update story's updatedAt
    await database.updateStory(this.ctx.currentStory.id, {})

    // Restore suggested actions from the new last narration entry
    this.ctx.restoreSuggestedActionsAfterDelete()
  }

  /**
   * Delete entities that were created after the backup.
   * Used for persistent retry restore to remove AI-extracted entities.
   * Compares current entity IDs against the saved ID lists and deletes any not in the lists.
   * NOTE: Lorebook entries are NOT included as they are independent of retry operations
   * (they are based on permanent chapters, not current chat).
   */
  async deleteEntitiesCreatedAfterBackup(savedIds: {
    characterIds: string[]
    locationIds: string[]
    itemIds: string[]
    storyBeatIds: string[]
    embeddedImageIds?: string[]
  }): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    const characterIdsSet = new Set(savedIds.characterIds)
    const locationIdsSet = new Set(savedIds.locationIds)
    const itemIdsSet = new Set(savedIds.itemIds)
    const storyBeatIdsSet = new Set(savedIds.storyBeatIds)
    const embeddedImageIdsSet = new Set(savedIds.embeddedImageIds ?? [])

    // Find entities to delete (not in saved lists)
    const charactersToDelete = this.ctx.character.characters.filter(
      (c) => !characterIdsSet.has(c.id),
    )
    const locationsToDelete = this.ctx.location.locations.filter((l) => !locationIdsSet.has(l.id))
    const itemsToDelete = this.ctx.item.items.filter((i) => !itemIdsSet.has(i.id))
    const storyBeatsToDelete = this.ctx.storyBeat.storyBeats.filter(
      (sb) => !storyBeatIdsSet.has(sb.id),
    )

    // Embedded images are not in memory - fetch from database to find ones to delete
    // Note: Many embedded images may already be deleted via CASCADE when entries are deleted
    const currentEmbeddedImages = await database.getEmbeddedImagesForStory(this.ctx.currentStory.id)
    const embeddedImagesToDelete = savedIds.embeddedImageIds
      ? currentEmbeddedImages.filter((ei) => !embeddedImageIdsSet.has(ei.id))
      : []

    log('Deleting entities created after backup', {
      characters: charactersToDelete.length,
      locations: locationsToDelete.length,
      items: itemsToDelete.length,
      storyBeats: storyBeatsToDelete.length,
      embeddedImages: embeddedImagesToDelete.length,
    })

    // Delete from database
    for (const character of charactersToDelete) {
      await database.deleteCharacter(character.id)
    }
    for (const location of locationsToDelete) {
      await database.deleteLocation(location.id)
    }
    for (const item of itemsToDelete) {
      await database.deleteItem(item.id)
    }
    for (const storyBeat of storyBeatsToDelete) {
      await database.deleteStoryBeat(storyBeat.id)
    }
    for (const embeddedImage of embeddedImagesToDelete) {
      await database.deleteEmbeddedImage(embeddedImage.id)
    }

    // Update in-memory state
    this.ctx.character.characters = this.ctx.character.characters.filter((c) =>
      characterIdsSet.has(c.id),
    )
    this.ctx.location.locations = this.ctx.location.locations.filter((l) =>
      locationIdsSet.has(l.id),
    )
    this.ctx.item.items = this.ctx.item.items.filter((i) => itemIdsSet.has(i.id))
    this.ctx.storyBeat.storyBeats = this.ctx.storyBeat.storyBeats.filter((sb) =>
      storyBeatIdsSet.has(sb.id),
    )

    // Update story's updatedAt
    await database.updateStory(this.ctx.currentStory.id, {})
  }

  /**
   * Import a SillyTavern chat into the current story, replacing all existing
   * main-branch entries. The current story must be loaded before calling this.
   */
  async importSTChat(messages: STChatMessage[]): Promise<void> {
    if (!this.ctx.currentStory) {
      throw new Error('No story loaded')
    }

    const storyId = this.ctx.currentStory.id

    // Branches fork off main-branch entries via fork_entry_id.
    // Deleting all main-branch entries would leave every branch with a
    // dangling FK reference — block the import if any branches exist.
    if (this.ctx.branch.branches.length > 0) {
      throw new Error(
        `Cannot import: this story has ${this.ctx.branch.branches.length} branch${this.ctx.branch.branches.length === 1 ? '' : 'es'}. ` +
          'Delete all branches before importing a SillyTavern chat.',
      )
    }

    // Wipe all existing main-branch entries
    await database.clearStoryEntries(storyId)

    // Build entry objects up front, then bulk-insert in batches
    // (O(n/50) IPC calls instead of O(n))
    const entries: Omit<StoryEntry, 'createdAt'>[] = messages.map((msg, i) => ({
      id: crypto.randomUUID(),
      storyId,
      type: msg.type,
      content: msg.content,
      parentId: null,
      position: i,
      metadata: { source: 'sillytavern_import' },
      branchId: null,
    }))
    await database.bulkInsertStoryEntries(entries)

    // Bump the story's updatedAt so the library view reflects the import
    await database.updateStory(storyId, {})
    this.ctx.currentStory = { ...this.ctx.currentStory!, updatedAt: Date.now() }

    // Reload entries into the store
    await this.ctx.branch.reloadEntriesForCurrentBranch()
  }

  /**
   * Trigger suggested-action generation after a SillyTavern import.
   * Called by the modal once the user has made their world-state choice,
   * so generation doesn't start before that dialog is resolved.
   */
  triggerSuggestionsAfterImport(): void {
    this.ctx.restoreSuggestedActionsAfterDelete()
  }

  /**
   * Rebuild the entry ID to index map for O(1) lookups.
   * Called when entries array changes significantly.
   */
  rebuildEntryIdIndex(): void {
    this._entryIdToIndex.clear()
    for (let i = 0; i < this.entries.length; i++) {
      this._entryIdToIndex.set(this.entries[i].id, i)
    }
  }

  /**
   * Get entries that are NOT part of any chapter (visible in context).
   * These are entries after the last chapter's endEntryId.
   * Per design doc section 3.1.2: summarized entries should be excluded from context.
   */
  get visibleEntries(): StoryEntry[] {
    if (this.ctx.chapter.chapters.length === 0) {
      // No chapters yet, all entries are visible
      return this.entries
    }
    // Return only entries after the last chapter
    return this.entries.slice(this.ctx.chapter.lastChapterEndIndex)
  }
}
