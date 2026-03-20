import type { StoryStore } from './index.svelte'
import type {
  Character,
  EmbeddedImage,
  Entry,
  Item,
  Location,
  StoryBeat,
  StoryEntry,
  TimeTracker,
} from '$lib/types'
import { database } from '$lib/services/database'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Retry]', ...args)
  }
}

export class StoryRetryStore {
  constructor(private ctx: StoryStore) {}

  isRetryInProgress = $state(false)

  /**
   * Restore story state from a retry backup.
   * Used by the "retry last message" feature to restore state before a user action
   * and allow regeneration.
   */
  async restoreFromRetryBackup(backup: {
    entries: StoryEntry[]
    characters: Character[]
    locations: Location[]
    items: Item[]
    storyBeats: StoryBeat[]
    lorebookEntries?: Entry[] // Optional - lorebook entries persist across retry operations
    embeddedImages: EmbeddedImage[]
    timeTracker?: TimeTracker | null
    entryCountBeforeAction: number
  }): Promise<void> {
    if (!this.ctx.currentStory) throw new Error('No story loaded')

    // Lock editing during retry restore to prevent race conditions
    this.isRetryInProgress = true
    log('Retry restore started - editing locked')

    try {
      // Debug: Log character visual descriptors before restore
      const currentCharDescriptors = this.ctx.character.characters.map((c) => ({
        name: c.name,
        visualDescriptors: c.visualDescriptors,
      }))
      const backupCharDescriptors = backup.characters.map((c) => ({
        name: c.name,
        visualDescriptors: c.visualDescriptors,
      }))
      log('RESTORE DEBUG - Before restore:', {
        currentCharDescriptors,
        backupCharDescriptors,
      })

      // Determine entries to delete (those added since the backup)
      const entriesToDelete = this.ctx.entry.entries.filter(
        (e) => e.position >= backup.entryCountBeforeAction,
      )
      const entryIdsToDelete = entriesToDelete.map((e) => e.id)

      log('Restoring from retry backup...', {
        entriesCount: backup.entries.length,
        currentEntriesCount: this.ctx.entry.entries.length,
        entriesToDelete: entryIdsToDelete.length,
        embeddedImagesCount: backup.embeddedImages.length,
      })

      // Restore to database (branch-aware: only delete/restore world state for current branch)
      await database.restoreRetryBackup(
        entryIdsToDelete,
        this.ctx.currentStory.id,
        this.ctx.currentStory.currentBranchId,
        backup.characters,
        backup.locations,
        backup.items,
        backup.storyBeats,
      )

      // Reload from database using branch-aware method for clean state
      await this.ctx.branch.reloadEntriesForCurrentBranch()

      // Debug: Log what we got back from database
      const dbCharDescriptors = this.ctx.character.characters.map((c) => ({
        name: c.name,
        visualDescriptors: c.visualDescriptors,
      }))
      log('RESTORE DEBUG - After DB reload:', {
        dbCharDescriptors,
      })

      // Invalidate caches after state restore
      this.ctx.generationContext.invalidateWordCountCache()
      this.ctx.chapter.invalidateChapterCache()

      // Debug: Verify memory state matches
      const finalCharDescriptors = this.ctx.character.characters.map((c) => ({
        name: c.name,
        visualDescriptors: c.visualDescriptors,
      }))
      log('RESTORE DEBUG - Final state:', {
        finalCharDescriptors,
      })

      // Restore time tracker if provided (null clears)
      await this.ctx.time.restoreTimeTrackerSnapshot(backup.timeTracker)

      log('Retry backup restored', {
        entries: this.ctx.entry.entries.length,
        characters: this.ctx.character.characters.length,
        locations: this.ctx.location.locations.length,
        embeddedImages: backup.embeddedImages.length,
      })
    } finally {
      // Always unlock editing when restore completes or fails
      this.isRetryInProgress = false
      log('Retry restore completed - editing unlocked')
    }
  }

  /**
   * Lock editing during retry operations.
   * Used by persistent restore path that doesn't call restoreFromRetryBackup.
   */
  lockRetryInProgress(): void {
    this.isRetryInProgress = true
    log('Retry operation locked - editing disabled')
  }

  /**
   * Unlock editing after retry operations complete.
   * Used by persistent restore path that doesn't call restoreFromRetryBackup.
   */
  unlockRetryInProgress(): void {
    this.isRetryInProgress = false
    log('Retry operation unlocked - editing enabled')
  }
}
