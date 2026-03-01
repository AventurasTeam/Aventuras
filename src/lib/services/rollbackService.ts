/**
 * RollbackService — Undoes world state changes by reversing deltas in order.
 *
 * When entries are deleted from a position onward, this service:
 * 1. Collects entries (position DESC) that have world_state_delta
 * 2. For each delta (newest first):
 *    - Deletes entities that were CREATED by that classification
 *    - Restores entities that were UPDATED to their before-state
 * 3. Restores current location and time tracker from the earliest rolled-back delta
 * 4. Cleans up auto-snapshots after the rollback position
 */

import type { WorldStateDelta, StoryEntry, TimeTracker } from '$lib/types'
import { settings } from '$lib/stores/settings.svelte'
import { database } from './database'

function log(...args: unknown[]) {
  if (settings.uiSettings.debugMode) {
    console.log('[RollbackService]', ...args)
  }
}

class RollbackService {
  /**
   * Roll back world state changes for entries at position >= fromPosition.
   * Processes deltas in reverse order (newest first) to correctly undo changes.
   *
   * @param storyId The story ID
   * @param branchId The branch ID (null for main branch)
   * @param fromPosition The position to roll back from (inclusive)
   * @param entries The in-memory entries array (will be filtered for relevant entries)
   * @returns Summary of what was rolled back
   */
  async rollbackFromPosition(
    storyId: string,
    branchId: string | null,
    fromPosition: number,
    entries: StoryEntry[],
  ): Promise<RollbackSummary> {
    const summary: RollbackSummary = {
      entriesProcessed: 0,
      entriesWithDelta: 0,
      entriesWithoutDelta: 0,
      deletedCharacters: 0,
      deletedLocations: 0,
      deletedItems: 0,
      deletedStoryBeats: 0,
      restoredCharacters: 0,
      restoredLocations: 0,
      restoredItems: 0,
      restoredStoryBeats: 0,
      restoredTimeTracker: false,
      restoredCurrentLocation: false,
    }

    // Get entries to rollback, sorted position DESC (newest first)
    const entriesToRollback = entries
      .filter((e) => e.position >= fromPosition)
      .sort((a, b) => b.position - a.position)

    if (entriesToRollback.length === 0) {
      log('No entries to rollback from position', fromPosition)
      return summary
    }

    log('Rolling back', entriesToRollback.length, 'entries from position', fromPosition)

    // Track the earliest delta's before-state for location and time restoration
    let earliestTimeTracker: TimeTracker | null | undefined = undefined
    let earliestCurrentLocationId: string | null | undefined = undefined

    for (const entry of entriesToRollback) {
      summary.entriesProcessed++

      const delta = entry.worldStateDelta
      if (!delta) {
        summary.entriesWithoutDelta++
        if (entry.type === 'narration') {
          log('Entry at position', entry.position, 'has no delta (pre-Phase 1 entry), skipping')
        }
        continue
      }

      summary.entriesWithDelta++

      // 1. Delete entities that were CREATED by this classification
      await this.deleteCreatedEntities(delta, summary)

      // 2. Restore entities that were UPDATED to their before-state
      await this.restoreUpdatedEntities(delta, summary)

      // Track the earliest (lowest position) delta's before-state
      // This represents the state BEFORE any of the rolled-back entries existed
      earliestTimeTracker = delta.previousState.timeTracker
      earliestCurrentLocationId = delta.previousState.currentLocationId
    }

    // 3. Restore time tracker from the earliest rolled-back delta
    if (earliestTimeTracker !== undefined) {
      try {
        if (earliestTimeTracker === null) {
          await database.clearTimeTracker(storyId)
        } else {
          await database.saveTimeTracker(storyId, earliestTimeTracker)
        }
        summary.restoredTimeTracker = true
        log('Time tracker restored to', earliestTimeTracker)
      } catch (error) {
        console.error('[RollbackService] Failed to restore time tracker:', error)
      }
    }

    // 4. Restore current location from the earliest rolled-back delta
    if (earliestCurrentLocationId !== undefined) {
      try {
        if (earliestCurrentLocationId) {
          await database.setCurrentLocation(storyId, earliestCurrentLocationId)
        } else {
          // No current location before rollback — unset all
          await this.clearCurrentLocation(storyId, branchId)
        }
        summary.restoredCurrentLocation = true
        log('Current location restored to', earliestCurrentLocationId)
      } catch (error) {
        console.error('[RollbackService] Failed to restore current location:', error)
      }
    }

    // 5. Clean up auto-snapshots after the rollback position
    try {
      await database.deleteWorldStateSnapshotsAfter(storyId, branchId, fromPosition - 1)
      log('Cleaned up snapshots after position', fromPosition - 1)
    } catch (error) {
      console.error('[RollbackService] Failed to clean up snapshots:', error)
    }

    // 6. Clean up no-op COW overrides (overrides whose data matches the original)
    try {
      const cleaned = await database.cleanupNoopOverrides(storyId, branchId)
      if (cleaned > 0) {
        log('Cleaned up', cleaned, 'no-op COW override(s)')
      }
    } catch (error) {
      console.error('[RollbackService] Failed to clean up no-op overrides:', error)
    }

    log('Rollback complete:', summary)
    return summary
  }

  /**
   * Delete entities that were created by a classification.
   */
  private async deleteCreatedEntities(
    delta: WorldStateDelta,
    summary: RollbackSummary,
  ): Promise<void> {
    const { createdEntities } = delta

    for (const id of createdEntities.characterIds) {
      try {
        await database.deleteCharacter(id)
        summary.deletedCharacters++
      } catch (error) {
        console.warn('[RollbackService] Failed to delete character', id, error)
      }
    }

    for (const id of createdEntities.locationIds) {
      try {
        await database.deleteLocation(id)
        summary.deletedLocations++
      } catch (error) {
        console.warn('[RollbackService] Failed to delete location', id, error)
      }
    }

    for (const id of createdEntities.itemIds) {
      try {
        await database.deleteItem(id)
        summary.deletedItems++
      } catch (error) {
        console.warn('[RollbackService] Failed to delete item', id, error)
      }
    }

    for (const id of createdEntities.storyBeatIds) {
      try {
        await database.deleteStoryBeat(id)
        summary.deletedStoryBeats++
      } catch (error) {
        console.warn('[RollbackService] Failed to delete story beat', id, error)
      }
    }
  }

  /**
   * Restore entities that were updated to their before-state values.
   */
  private async restoreUpdatedEntities(
    delta: WorldStateDelta,
    summary: RollbackSummary,
  ): Promise<void> {
    const { previousState } = delta

    for (const charBefore of previousState.characters) {
      try {
        await database.updateCharacter(charBefore.id, {
          status: charBefore.status as 'active' | 'inactive' | 'deceased',
          relationship: charBefore.relationship,
          traits: charBefore.traits,
          visualDescriptors: charBefore.visualDescriptors,
          ...(charBefore.metadata !== undefined ? { metadata: charBefore.metadata } : {}),
        })
        summary.restoredCharacters++
      } catch (error) {
        console.warn('[RollbackService] Failed to restore character', charBefore.id, error)
      }
    }

    for (const locBefore of previousState.locations) {
      try {
        await database.updateLocation(locBefore.id, {
          visited: locBefore.visited,
          current: locBefore.current,
          description: locBefore.description,
          ...(locBefore.metadata !== undefined ? { metadata: locBefore.metadata } : {}),
        })
        summary.restoredLocations++
      } catch (error) {
        console.warn('[RollbackService] Failed to restore location', locBefore.id, error)
      }
    }

    for (const itemBefore of previousState.items) {
      try {
        await database.updateItem(itemBefore.id, {
          quantity: itemBefore.quantity,
          equipped: itemBefore.equipped,
          location: itemBefore.location,
          ...(itemBefore.metadata !== undefined ? { metadata: itemBefore.metadata } : {}),
        })
        summary.restoredItems++
      } catch (error) {
        console.warn('[RollbackService] Failed to restore item', itemBefore.id, error)
      }
    }

    for (const beatBefore of previousState.storyBeats) {
      try {
        await database.updateStoryBeat(beatBefore.id, {
          status: beatBefore.status as 'pending' | 'active' | 'completed' | 'failed',
          description: beatBefore.description,
          resolvedAt: beatBefore.resolvedAt,
          ...(beatBefore.metadata !== undefined ? { metadata: beatBefore.metadata } : {}),
        })
        summary.restoredStoryBeats++
      } catch (error) {
        console.warn('[RollbackService] Failed to restore story beat', beatBefore.id, error)
      }
    }
  }

  /**
   * Clear current location flag for all locations in a story/branch.
   */
  private async clearCurrentLocation(storyId: string, branchId: string | null): Promise<void> {
    // Use raw update to clear all current flags — no single entity to "set current"
    const locations =
      branchId === null
        ? await database.getLocationsForBranch(storyId, null)
        : await database.getLocationsForBranch(storyId, branchId)

    for (const loc of locations) {
      if (loc.current) {
        await database.updateLocation(loc.id, { current: false })
      }
    }
  }
}

export interface RollbackSummary {
  entriesProcessed: number
  entriesWithDelta: number
  entriesWithoutDelta: number
  deletedCharacters: number
  deletedLocations: number
  deletedItems: number
  deletedStoryBeats: number
  restoredCharacters: number
  restoredLocations: number
  restoredItems: number
  restoredStoryBeats: number
  restoredTimeTracker: boolean
  restoredCurrentLocation: boolean
}

export const rollbackService = new RollbackService()
