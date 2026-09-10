/**
 * RetryService - Manages retry/stop/restore operations for generation
 *
 * Extracted from ActionInput.svelte to provide a focused service for:
 * - Backup state preparation before user actions
 * - State restoration after stopping generation
 * - Full state and persistent (ID-based) restore paths
 */

import type {
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  TimeTracker,
  ActionInputType,
  PersistentCharacterSnapshot,
} from '$lib/types'
import { createLogger } from '$lib/log'

const log = createLogger('RetryService')

/**
 * Backup data structure - mirrors RetryBackup from ui.svelte.ts
 */
export interface RetryBackupData {
  storyId: string
  /** The branch the snapshot was taken on. It may only be restored onto that branch. */
  branchId: string | null
  timestamp: number
  entries: StoryEntry[]
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  userActionContent: string
  rawInput: string
  actionType: ActionInputType
  wasRawActionChoice: boolean
  activationData: Record<string, number>
  storyPosition: number
  entryCountBeforeAction: number
  hasFullState: boolean
  hasEntityIds: boolean
  characterIds: string[]
  locationIds: string[]
  itemIds: string[]
  storyBeatIds: string[]
  embeddedImageIds?: string[]
  characterSnapshots?: PersistentCharacterSnapshot[]
  timeTracker: TimeTracker | null | undefined
}

/**
 * Callbacks for store operations - allows RetryService to work without direct store imports
 */
export interface RetryStoreCallbacks {
  // Story store operations
  restoreFromRetryBackup: (backup: {
    branchId: string | null
    entries: StoryEntry[]
    characters: Character[]
    locations: Location[]
    items: Item[]
    storyBeats: StoryBeat[]
    timeTracker?: TimeTracker | null
    entryCountBeforeAction: number
  }) => Promise<void>
  deleteEntriesFromPosition: (position: number) => Promise<void>
  deleteEntitiesCreatedAfterBackup: (savedIds: {
    characterIds: string[]
    locationIds: string[]
    itemIds: string[]
    storyBeatIds: string[]
    embeddedImageIds?: string[]
  }) => Promise<void>
  restoreCharacterSnapshots: (snapshots?: PersistentCharacterSnapshot[]) => Promise<void>
  restoreTimeTrackerSnapshot: (snapshot: TimeTracker | null | undefined) => Promise<void>
  /** Throws if the entries from this position on cannot be removed. */
  assertEntriesRemovable: (position: number) => void
  lockRetryInProgress: () => void
  unlockRetryInProgress: () => void

  // UI store operations
  restoreActivationData: (data: Record<string, number>, position: number) => void
  clearActivationData: () => void
  setLastLorebookRetrieval: (result: null) => void
}

/**
 * Result of a restore operation
 */
export interface RestoreResult {
  success: boolean
  error?: string
  restoredActionType?: ActionInputType
  restoredWasRawActionChoice?: boolean
  restoredRawInput?: string
}

/**
 * RetryService provides centralized retry/restore functionality.
 *
 * This service handles:
 * - Full state restore (in-memory backup with all entity snapshots)
 * - Persistent restore (ID-based cleanup for cross-session retry)
 */
export class RetryService {
  /**
   * Restore state from a backup (for stop generation).
   * Determines restore path based on backup.hasFullState.
   */
  async restoreFromBackup(
    backup: RetryBackupData,
    callbacks: RetryStoreCallbacks,
    activeBranchId: string | null,
  ): Promise<RestoreResult> {
    log('restoreFromBackup called', {
      hasFullState: backup.hasFullState,
      hasEntityIds: backup.hasEntityIds,
      entryCountBeforeAction: backup.entryCountBeforeAction,
    })

    // Enforced here rather than only in preflight: this method is public, and a rewind
    // reachable without the check is a rewind without the check. Positions are reused across
    // sibling branches, so a foreign snapshot deletes rows that merely share a number.
    const refusedForBranch = this.refuseForeignBranch(backup, activeBranchId)
    if (refusedForBranch) return refusedForBranch

    try {
      if (backup.hasFullState) {
        // Full state restore path
        await this.restoreFullState(backup, callbacks)
      } else {
        // Persistent (ID-based) restore path
        await this.restorePersistentState(backup, callbacks)
      }

      return {
        success: true,
        restoredActionType: backup.actionType,
        restoredWasRawActionChoice: backup.wasRawActionChoice,
        restoredRawInput: backup.rawInput,
      }
    } catch (error) {
      log('Restore failed', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown restore error',
      }
    }
  }

  private refuseForeignBranch(
    backup: RetryBackupData,
    activeBranchId: string | null,
  ): RestoreResult | null {
    if ((backup.branchId ?? null) === (activeBranchId ?? null)) return null
    log('Restore refused: snapshot belongs to another branch', {
      snapshotBranchId: backup.branchId,
      activeBranchId,
    })
    return {
      success: false,
      error:
        'This snapshot was taken on another branch. Switch back to it to retry, or ' +
        'regenerate the last response on this branch instead.',
    }
  }

  /**
   * Both entry points run this before they touch anything: the restore paths rewind lorebook
   * activation and clear the suggestions before they reach the entries, and a refusal that
   * surfaced later would leave all of that applied with nothing undone.
   */
  private preflight(
    backup: RetryBackupData,
    callbacks: RetryStoreCallbacks,
    activeBranchId: string | null,
  ): RestoreResult | null {
    const refusedForBranch = this.refuseForeignBranch(backup, activeBranchId)
    if (refusedForBranch) return refusedForBranch
    try {
      callbacks.assertEntriesRemovable(backup.entryCountBeforeAction)
      return null
    } catch (error) {
      log('Restore refused before any state was touched', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown restore error',
      }
    }
  }

  /**
   * Restore from full in-memory state backup.
   */
  private async restoreFullState(
    backup: RetryBackupData,
    callbacks: RetryStoreCallbacks,
  ): Promise<void> {
    log('Restoring full state from backup')

    // Restore activation data first
    callbacks.restoreActivationData(backup.activationData, backup.storyPosition)

    // Restore story state (this handles locking internally)
    await callbacks.restoreFromRetryBackup({
      branchId: backup.branchId,
      entries: backup.entries,
      characters: backup.characters,
      locations: backup.locations,
      items: backup.items,
      storyBeats: backup.storyBeats,
      timeTracker: backup.timeTracker,
      entryCountBeforeAction: backup.entryCountBeforeAction,
    })

    log('Full state restore complete')
  }

  /**
   * Restore from persistent backup (ID-based cleanup).
   * Used when we only have entity IDs, not full snapshots.
   */
  private async restorePersistentState(
    backup: RetryBackupData,
    callbacks: RetryStoreCallbacks,
  ): Promise<void> {
    log('Restoring persistent state (ID-based)', {
      entryCountBeforeAction: backup.entryCountBeforeAction,
      hasEntityIds: backup.hasEntityIds,
    })

    // Lock editing during restore
    callbacks.lockRetryInProgress()

    try {
      // Restore activation data (lorebook stickiness) from backup
      if (backup.activationData && Object.keys(backup.activationData).length > 0) {
        callbacks.restoreActivationData(backup.activationData, backup.storyPosition)
      } else {
        callbacks.clearActivationData()
      }

      // Delete entries from the backup position onward
      log('Deleting entries from position', backup.entryCountBeforeAction)
      await callbacks.deleteEntriesFromPosition(backup.entryCountBeforeAction)

      // Delete entities created after backup (if we have ID snapshots)
      if (backup.hasEntityIds) {
        log('Deleting entities created after backup')
        await callbacks.deleteEntitiesCreatedAfterBackup({
          characterIds: backup.characterIds,
          locationIds: backup.locationIds,
          itemIds: backup.itemIds,
          storyBeatIds: backup.storyBeatIds,
          embeddedImageIds: backup.embeddedImageIds,
        })
      } else {
        log('Skipping entity cleanup (no ID snapshot)')
      }

      // Restore character field snapshots
      await callbacks.restoreCharacterSnapshots(backup.characterSnapshots)

      // Restore time tracker
      await callbacks.restoreTimeTrackerSnapshot(backup.timeTracker)

      log('Persistent state restore complete')
    } finally {
      callbacks.unlockRetryInProgress()
    }
  }

  /**
   * Prepare for stop generation - performs full restore including UI cleanup.
   */
  async handleStopGeneration(
    backup: RetryBackupData,
    callbacks: RetryStoreCallbacks,
    uiCleanup: {
      clearGenerationError: () => void
      clearSuggestions: () => void
      clearActionChoices: () => void
    },
    activeBranchId: string | null,
  ): Promise<RestoreResult> {
    log('handleStopGeneration called')

    const refused = this.preflight(backup, callbacks, activeBranchId)
    if (refused) return refused

    // Clear UI state first
    uiCleanup.clearGenerationError()
    uiCleanup.clearSuggestions()
    uiCleanup.clearActionChoices()

    // Clear lorebook retrieval debug state
    callbacks.setLastLorebookRetrieval(null)

    // Perform restore
    return this.restoreFromBackup(backup, callbacks, activeBranchId)
  }

  /**
   * Prepare for retry last message - performs full restore for regeneration.
   */
  async handleRetryLastMessage(
    backup: RetryBackupData,
    callbacks: RetryStoreCallbacks,
    uiCleanup: {
      clearGenerationError: () => void
      clearSuggestions: () => void
      clearActionChoices: () => void
    },
    activeBranchId: string | null,
  ): Promise<RestoreResult> {
    log('handleRetryLastMessage called', {
      hasFullState: backup.hasFullState,
      entryCountBeforeAction: backup.entryCountBeforeAction,
    })

    const refused = this.preflight(backup, callbacks, activeBranchId)
    if (refused) return refused

    // Clear UI state
    uiCleanup.clearGenerationError()
    uiCleanup.clearSuggestions()
    uiCleanup.clearActionChoices()

    // Clear lorebook retrieval debug state
    callbacks.setLastLorebookRetrieval(null)

    // Perform restore
    return this.restoreFromBackup(backup, callbacks, activeBranchId)
  }
}

// Export singleton instance
export const retryService = new RetryService()
