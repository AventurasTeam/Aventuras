import { database } from '$lib/services/database'
import type {
  Branch,
  Chapter,
  Character,
  Checkpoint,
  Entry,
  Item,
  Location,
  StoryBeat,
  StoryEntry,
  TimeTracker,
  WorldStateSnapshot,
} from '$lib/types'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import { settings } from '../settings.svelte'
import type { StoryStore } from './index.svelte'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Branch]', ...args)
  }
}

export class StoryBranchStore {
  constructor(private story: StoryStore) {}
  branches = $state<Branch[]>([])
  currentBranchId = $state<string | null>(null)

  /**
   * Get the current branch, or null if on the main branch (for legacy stories)
   */
  get currentBranch(): Branch | null {
    if (!this.currentBranchId) return null
    return this.branches.find((b) => b.id === this.currentBranchId) ?? null
  }

  /**
   * Create a new branch from an existing checkpoint.
   * Only entries with checkpoints can be branched from.
   */
  async createBranchFromCheckpoint(
    name: string,
    forkEntryId: string,
    checkpointId: string,
  ): Promise<Branch> {
    if (!this.story.id) throw new Error('No story loaded')

    // Verify the checkpoint exists in memory
    const checkpoint = this.story.checkpoint.checkpoints.find((cp) => cp.id === checkpointId)
    if (!checkpoint) {
      throw new Error('Checkpoint not found in memory')
    }

    // Verify the checkpoint matches the fork entry
    if (checkpoint.lastEntryId !== forkEntryId) {
      throw new Error('Checkpoint does not match fork entry')
    }

    // Verify all foreign key references exist in the database
    const dbCheckpoint = await database.getCheckpoint(checkpointId)
    if (!dbCheckpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found in database`)
    }

    const dbEntry = await database.getStoryEntry(forkEntryId)
    if (!dbEntry) {
      throw new Error(`Fork entry ${forkEntryId} not found in database`)
    }

    const dbStory = await database.getStory(this.story.id!)
    if (!dbStory) {
      throw new Error(`Story ${this.story.id!} not found in database`)
    }

    // Determine parent branch (current branch, or null for main)
    // IMPORTANT: Ensure it's explicitly null, not undefined
    const parentBranchId = this.story.branch.currentBranchId ?? null

    // If there's a parent branch, verify it exists
    if (parentBranchId !== null) {
      const dbParentBranch = await database.getBranch(parentBranchId)
      if (!dbParentBranch) {
        throw new Error(`Parent branch ${parentBranchId} not found in database`)
      }
    }

    // Create the branch
    const branch: Branch = {
      id: crypto.randomUUID(),
      storyId: this.story.id!,
      name,
      parentBranchId,
      forkEntryId,
      checkpointId,
      createdAt: Date.now(),
    }

    await database.addBranch(branch)
    this.branches = [...this.branches, branch]

    // Inherit background from checkpoint
    const checkpointBg = await database.getBackgroundForCheckpoint(this.story.id!, checkpointId)
    if (checkpointBg) {
      log('Inheriting background from checkpoint for new branch:', branch.name)
      await database.saveBackground(this.story.id!, branch.id, null, checkpointBg)
    }

    // Copy world state from checkpoint into database with the new branch_id
    // This ensures the branch has its own copy of the world state at the fork point
    if (settings.experimentalFeatures.lightweightBranches) {
      // Snapshot isolation: copy all entities from checkpoint into the new branch.
      // Each branch gets its own complete entity set for full isolation.
      log('COW branch: copying entity snapshot for branch isolation')

      // Copy characters
      for (const char of checkpoint.charactersSnapshot) {
        const branchChar: Character = {
          ...char,
          id: crypto.randomUUID(),
          branchId: branch.id,
          overridesId: null,
        }
        await database.addCharacter(branchChar)
      }

      // Copy locations — remap connection IDs to new location IDs
      const locationIdMap = new SvelteMap<string, string>()
      for (const loc of checkpoint.locationsSnapshot) {
        locationIdMap.set(loc.id, crypto.randomUUID())
      }
      for (const loc of checkpoint.locationsSnapshot) {
        const newId = locationIdMap.get(loc.id)!
        const branchLoc: Location = {
          ...loc,
          id: newId,
          branchId: branch.id,
          overridesId: null,
          connections: loc.connections.map((connId) => locationIdMap.get(connId) ?? connId),
        }
        await database.addLocation(branchLoc)
      }

      // Copy items — remap location IDs to the new branch's locations
      for (const item of checkpoint.itemsSnapshot) {
        const remappedLocation =
          item.location === 'inventory'
            ? 'inventory'
            : (locationIdMap.get(item.location) ?? item.location)
        const branchItem: Item = {
          ...item,
          id: crypto.randomUUID(),
          branchId: branch.id,
          overridesId: null,
          location: remappedLocation,
        }
        await database.addItem(branchItem)
      }

      // Copy story beats
      for (const beat of checkpoint.storyBeatsSnapshot) {
        const branchBeat: StoryBeat = {
          ...beat,
          id: crypto.randomUUID(),
          branchId: branch.id,
          overridesId: null,
        }
        await database.addStoryBeat(branchBeat)
      }

      // Copy lorebook entries
      if (checkpoint.lorebookEntriesSnapshot) {
        for (const entry of checkpoint.lorebookEntriesSnapshot) {
          const branchEntry: Entry = {
            ...entry,
            id: crypto.randomUUID(),
            branchId: branch.id,
            overridesId: null,
          }
          await database.addEntry(branchEntry)
        }
      }

      // Mark branch as snapshot-complete so loading uses direct queries (no lineage resolution)
      await database.setBranchSnapshotComplete(branch.id)
      this.branches = this.branches.map((b) =>
        b.id === branch.id ? { ...b, snapshotComplete: true } : b,
      )

      log('COW branch: entity snapshot complete', {
        characters: checkpoint.charactersSnapshot.length,
        locations: checkpoint.locationsSnapshot.length,
        items: checkpoint.itemsSnapshot.length,
        storyBeats: checkpoint.storyBeatsSnapshot.length,
        lorebookEntries: checkpoint.lorebookEntriesSnapshot?.length ?? 0,
      })

      // Create a world state snapshot at the fork point for rollback support
      if (settings.experimentalFeatures.stateTracking) {
        try {
          const snapshot: WorldStateSnapshot = {
            id: crypto.randomUUID(),
            storyId: this.story.id!,
            branchId: branch.id,
            entryId: forkEntryId,
            entryPosition: dbEntry.position,
            charactersSnapshot: checkpoint.charactersSnapshot,
            locationsSnapshot: checkpoint.locationsSnapshot,
            itemsSnapshot: checkpoint.itemsSnapshot,
            storyBeatsSnapshot: checkpoint.storyBeatsSnapshot,
            lorebookEntriesSnapshot: checkpoint.lorebookEntriesSnapshot,
            timeTrackerSnapshot: checkpoint.timeTrackerSnapshot ?? null,
            createdAt: Date.now(),
          }
          await database.createWorldStateSnapshot(snapshot)
          log('COW branch: created fork-point snapshot')
        } catch (error) {
          console.error('[StoryStore] Failed to create fork-point snapshot:', error)
        }
      }
    } else {
      // Legacy path: full copy of all entities from checkpoint
      log('Copying world state from checkpoint to branch:', branch.name)

      // Copy characters
      for (const char of checkpoint.charactersSnapshot) {
        const branchChar: Character = { ...char, id: crypto.randomUUID(), branchId: branch.id }
        await database.addCharacter(branchChar)
      }

      // Copy locations - need to remap connection IDs to new location IDs
      const locationIdMap = new SvelteMap<string, string>() // old ID -> new ID
      for (const loc of checkpoint.locationsSnapshot) {
        const newId = crypto.randomUUID()
        locationIdMap.set(loc.id, newId)
      }
      for (const loc of checkpoint.locationsSnapshot) {
        const newId = locationIdMap.get(loc.id)!
        const branchLoc: Location = {
          ...loc,
          id: newId,
          branchId: branch.id,
          // Remap connections to use new location IDs
          connections: loc.connections.map((connId) => locationIdMap.get(connId) ?? connId),
        }
        await database.addLocation(branchLoc)
      }

      // Copy items (remap location IDs to the new branch's locations)
      for (const item of checkpoint.itemsSnapshot) {
        const remappedLocation =
          item.location === 'inventory'
            ? 'inventory'
            : (locationIdMap.get(item.location) ?? item.location)
        const branchItem: Item = {
          ...item,
          id: crypto.randomUUID(),
          branchId: branch.id,
          location: remappedLocation,
        }
        await database.addItem(branchItem)
      }

      // Copy story beats
      for (const beat of checkpoint.storyBeatsSnapshot) {
        const branchBeat: StoryBeat = { ...beat, id: crypto.randomUUID(), branchId: branch.id }
        await database.addStoryBeat(branchBeat)
      }

      // Copy lorebook entries (if snapshot exists)
      if (checkpoint.lorebookEntriesSnapshot) {
        for (const entry of checkpoint.lorebookEntriesSnapshot) {
          const branchEntry: Entry = { ...entry, id: crypto.randomUUID(), branchId: branch.id }
          await database.addEntry(branchEntry)
        }
      }
    }

    // Switch to the new branch (skip restore since we just populated the world state)
    await this.switchBranch(branch.id, true)

    // Reload the world state from database to get the copied items into memory
    await this.reloadEntriesForCurrentBranch()

    // Restore time tracker from checkpoint
    if (checkpoint.timeTrackerSnapshot) {
      this.story.time.load({ ...checkpoint.timeTrackerSnapshot })
      await database.updateStory(this.story.id!, {
        timeTracker: checkpoint.timeTrackerSnapshot,
      })
      log('Time tracker restored from checkpoint:', checkpoint.timeTrackerSnapshot)
    }

    log('Branch created:', name, 'from checkpoint:', checkpointId, {
      characters: checkpoint.charactersSnapshot.length,
      locations: checkpoint.locationsSnapshot.length,
      items: checkpoint.itemsSnapshot.length,
      storyBeats: checkpoint.storyBeatsSnapshot.length,
      lorebookEntries: checkpoint.lorebookEntriesSnapshot?.length ?? 0,
    })
    return branch
  }

  buildBranchLineage(branchId: string): Branch[] {
    const lineage: Branch[] = []
    let current: Branch | null = this.branches.find((b) => b.id === branchId) ?? null
    const visited = new SvelteSet<string>()

    while (current) {
      if (visited.has(current.id)) break
      visited.add(current.id)
      lineage.unshift(current)
      const parentId = current.parentBranchId
      if (!parentId) break
      current = this.branches.find((b) => b.id === parentId) ?? null
    }

    return lineage
  }

  private async getForkEntryPositions(
    lineage: Branch[],
  ): Promise<SvelteMap<string, number | null>> {
    const entries = await Promise.all(
      lineage.map((branch) => database.getStoryEntry(branch.forkEntryId)),
    )
    const positions = new SvelteMap<string, number | null>()
    entries.forEach((entry, index) => {
      positions.set(lineage[index].id, entry?.position ?? null)
    })
    return positions
  }

  private getCheckpointBranchId(checkpoint: Checkpoint): string | null {
    const lastEntry = checkpoint.entriesSnapshot.find((e) => e.id === checkpoint.lastEntryId)
    return lastEntry?.branchId ?? null
  }

  /**
   * Switch to a different branch.
   * This reloads entries from the database filtered by the target branch.
   * NO data is deleted - branches coexist in the database with different branch_ids.
   * @param branchId - The branch to switch to (null for main branch)
   * @param skipReload - If true, skip reloading entries (used when creating new branch from current state)
   */
  async switchBranch(branchId: string | null, skipReload: boolean = false): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    // Validate branch exists (if not null)
    if (branchId !== null) {
      const branch = this.branches.find((b) => b.id === branchId)
      if (!branch) throw new Error('Branch not found')
    }

    // Update story's current branch in database
    await database.setStoryCurrentBranch(this.story.id!, branchId)
    this.story.branch.currentBranchId = branchId

    // Reload entries from database if not skipping
    // When creating a new branch, we skip because we're already at the correct state
    if (!skipReload) {
      await this.reloadEntriesForCurrentBranch()
    }

    // Invalidate caches
    this.story.generationContext.invalidateWordCountCache()
    this.story.chapter.invalidateChapterCache()

    // Reload background from database for the branch
    this.story.image.currentBgImage = await database.getBackgroundForBranch(
      this.story.id!,
      branchId,
    )

    // Restore suggested actions from the new branch's last narration entry
    // Without this, stale actions from the previous branch persist in the UI
    this.story.restoreSuggestedActionsAfterDelete()

    log('Switched to branch:', branchId ?? 'main')
  }

  /**
   * Reload entries and world state from database for the current branch.
   * World state is now persisted per-branch in the database via branch_id columns.
   * - For main branch: loads only items with null branch_id
   * - For other branches: loads inherited items (null branch_id) + branch-specific items
   */
  async reloadEntriesForCurrentBranch(): Promise<void> {
    if (!this.story.id) return

    const branchId = this.story.branch.currentBranchId

    if (branchId === null) {
      // Main branch: load all data with null branch_id
      const [entries, chapters, characters, locations, items, storyBeats, lorebookEntries] =
        await Promise.all([
          database.getStoryEntriesForBranch(this.story.id!, null),
          database.getChaptersForBranch(this.story.id!, null),
          database.getCharactersForBranch(this.story.id!, null),
          database.getLocationsForBranch(this.story.id!, null),
          database.getItemsForBranch(this.story.id!, null),
          database.getStoryBeatsForBranch(this.story.id!, null),
          database.getEntriesForBranch(this.story.id!, null),
        ])

      this.story.entry.rawEntries = entries
      this.story.chapter.chapters = chapters
      this.story.character.characters = characters
      this.story.location.locations = locations
      this.story.item.items = items
      this.story.storyBeat.storyBeats = storyBeats
      this.story.lorebook.lorebookEntries = lorebookEntries

      // Filter out tombstoned entities when COW is enabled
      if (settings.experimentalFeatures.lightweightBranches) {
        this.story.character.characters = this.story.character.characters.filter((c) => !c.deleted)
        this.story.location.locations = this.story.location.locations.filter((l) => !l.deleted)
        this.story.item.items = this.story.item.items.filter((i) => !i.deleted)
        this.story.storyBeat.storyBeats = this.story.storyBeat.storyBeats.filter((b) => !b.deleted)
        this.story.lorebook.lorebookEntries = this.story.lorebook.lorebookEntries.filter(
          (e) => !e.deleted,
        )
      }
    } else {
      // Non-main branch: load entries across branch lineage (main -> ancestors -> current)
      const lineage = this.buildBranchLineage(branchId)
      if (lineage.length === 0) return

      const forkPositions = await this.getForkEntryPositions(lineage)
      const rootForkPosition = forkPositions.get(lineage[0].id)

      const inheritedEntries = await database.getStoryEntriesForBranch(
        this.story.id!,
        null,
        rootForkPosition ?? undefined,
      )

      const branchEntries: StoryEntry[] = []
      for (let i = 0; i < lineage.length; i++) {
        const branch = lineage[i]
        const childForkPosition =
          i < lineage.length - 1 ? forkPositions.get(lineage[i + 1].id) : undefined
        const entries = await database.getStoryEntriesForBranch(
          this.story.id!,
          branch.id,
          childForkPosition ?? undefined,
        )
        branchEntries.push(...entries)
      }

      this.story.entry.rawEntries = [...inheritedEntries, ...branchEntries].sort(
        (a, b) => a.position - b.position,
      )

      const entryPositions = new SvelteMap<string, number>()
      for (const entry of this.story.entry.rawEntries) {
        entryPositions.set(entry.id, entry.position)
      }

      const chapters: Chapter[] = []
      const mainChapters = await database.getChaptersForBranch(this.story.id!, null)
      if (rootForkPosition === null || rootForkPosition === undefined) {
        chapters.push(...mainChapters)
      } else {
        chapters.push(
          ...mainChapters.filter((ch) => {
            const endPosition = entryPositions.get(ch.endEntryId)
            return endPosition !== undefined && endPosition <= rootForkPosition
          }),
        )
      }

      for (let i = 0; i < lineage.length; i++) {
        const branch = lineage[i]
        const childForkPosition =
          i < lineage.length - 1 ? forkPositions.get(lineage[i + 1].id) : undefined
        const branchChapters = await database.getChaptersForBranch(this.story.id!, branch.id)
        if (childForkPosition === null || childForkPosition === undefined) {
          chapters.push(...branchChapters)
        } else {
          chapters.push(
            ...branchChapters.filter((ch) => {
              const endPosition = entryPositions.get(ch.endEntryId)
              return endPosition !== undefined && endPosition <= childForkPosition
            }),
          )
        }
      }

      this.story.chapter.chapters = chapters.sort((a, b) => a.number - b.number)

      // Load world state from database
      // COW branches use resolved loading (walks lineage), legacy branches use direct loading
      let characters: Character[]
      let locations: Location[]
      let items: Item[]
      let storyBeats: StoryBeat[]
      let lorebookEntries: Entry[]

      if (settings.experimentalFeatures.lightweightBranches) {
        const currentBranchInfo = this.branches.find((b) => b.id === branchId)
        if (currentBranchInfo?.snapshotComplete) {
          // Snapshot isolation: branch has its own complete entity set
          ;[characters, locations, items, storyBeats, lorebookEntries] = await Promise.all([
            database.getCharactersForBranch(this.story.id!, branchId),
            database.getLocationsForBranch(this.story.id!, branchId),
            database.getItemsForBranch(this.story.id!, branchId),
            database.getStoryBeatsForBranch(this.story.id!, branchId),
            database.getEntriesForBranch(this.story.id!, branchId),
          ])
          // Filter out tombstoned entities
          characters = characters.filter((c) => !c.deleted)
          locations = locations.filter((l) => !l.deleted)
          items = items.filter((i) => !i.deleted)
          storyBeats = storyBeats.filter((b) => !b.deleted)
          lorebookEntries = lorebookEntries.filter((e) => !e.deleted)
          log('Snapshot isolation: loaded entities for branch:', branchId, {
            characters: characters.length,
            locations: locations.length,
            items: items.length,
            storyBeats: storyBeats.length,
            lorebookEntries: lorebookEntries.length,
          })
        } else {
          // Legacy COW: resolve through lineage (pre-snapshot branches)
          ;[characters, locations, items, storyBeats, lorebookEntries] = await Promise.all([
            database.getCharactersResolved(this.story.id!, lineage),
            database.getLocationsResolved(this.story.id!, lineage),
            database.getItemsResolved(this.story.id!, lineage),
            database.getStoryBeatsResolved(this.story.id!, lineage),
            database.getLorebookEntriesResolved(this.story.id!, lineage),
          ])
          log('COW: Resolved world state through lineage for branch:', branchId, {
            lineageDepth: lineage.length,
            characters: characters.length,
            locations: locations.length,
            items: items.length,
            storyBeats: storyBeats.length,
            lorebookEntries: lorebookEntries.length,
          })
        }
      } else {
        // Legacy path: direct branch loading (entities were fully copied at branch creation)
        ;[characters, locations, items, storyBeats, lorebookEntries] = await Promise.all([
          database.getCharactersForBranch(this.story.id!, branchId),
          database.getLocationsForBranch(this.story.id!, branchId),
          database.getItemsForBranch(this.story.id!, branchId),
          database.getStoryBeatsForBranch(this.story.id!, branchId),
          database.getEntriesForBranch(this.story.id!, branchId),
        ])
      }

      this.story.character.characters = characters
      this.story.location.locations = locations
      this.story.item.items = items
      this.story.storyBeat.storyBeats = storyBeats
      this.story.lorebook.lorebookEntries = lorebookEntries

      // Get the current branch name from lineage for logging
      const currentBranch = lineage[lineage.length - 1]
      log('Loaded world state for branch:', currentBranch?.name ?? branchId, {
        characters: characters.length,
        locations: locations.length,
        items: items.length,
        storyBeats: storyBeats.length,
        lorebookEntries: lorebookEntries.length,
      })
    }

    // Restore time tracker from the last entry's metadata
    await this.restoreTimeFromLastEntry()
  }

  /**
   * Restore time tracker from the last entry's timeEnd metadata.
   * Called after loading entries for a branch to ensure time consistency.
   */
  private async restoreTimeFromLastEntry(): Promise<void> {
    if (!this.story.id || this.story.entry.rawEntries.length === 0) return

    const lastEntry = this.story.entry.rawEntries[this.story.entry.rawEntries.length - 1]
    const timeEnd = lastEntry.metadata?.timeEnd

    if (timeEnd && typeof timeEnd === 'object') {
      const newTime = timeEnd as TimeTracker
      // Only update if different to avoid unnecessary DB writes
      const current = this.story.time.timeTracker
      if (
        !current ||
        current.years !== newTime.years ||
        current.days !== newTime.days ||
        current.hours !== newTime.hours ||
        current.minutes !== newTime.minutes
      ) {
        this.story.time.load(newTime)
        await database.updateStory(this.story.id!, { timeTracker: newTime })
        log('Time tracker restored from last entry:', newTime)
      }
    }
  }

  /**
   * Rename a branch.
   */
  async renameBranch(branchId: string, newName: string): Promise<void> {
    await database.updateBranch(branchId, { name: newName })
    this.branches = this.branches.map((b) => (b.id === branchId ? { ...b, name: newName } : b))
    log('Branch renamed:', branchId, 'to', newName)
  }

  /**
   * Delete a branch.
   * Cannot delete the main branch (null), the current branch, or branches with children.
   */
  async deleteBranch(branchId: string): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    // Cannot delete current branch
    if (this.story.branch.currentBranchId === branchId) {
      throw new Error('Cannot delete the current branch')
    }

    // Cannot delete branches that have child branches
    const childBranches = this.branches.filter((b) => b.parentBranchId === branchId)
    if (childBranches.length > 0) {
      const childNames = childBranches.map((b) => `"${b.name}"`).join(', ')
      throw new Error(
        `Cannot delete this branch because it has child branches: ${childNames}. ` +
          `Delete the child branches first.`,
      )
    }

    // Delete associated checkpoints first
    const checkpointsToDelete = this.story.checkpoint.checkpoints.filter(
      (checkpoint) => this.getCheckpointBranchId(checkpoint) === branchId,
    )
    await Promise.all(checkpointsToDelete.map((cp) => database.deleteCheckpoint(cp.id)))
    this.story.checkpoint.checkpoints = this.story.checkpoint.checkpoints.filter(
      (checkpoint) => this.getCheckpointBranchId(checkpoint) !== branchId,
    )

    // Delete the branch from database
    await database.deleteBranch(branchId)

    // Update in-memory state: remove deleted branch
    // Note: We already checked that there are no child branches, so no reparenting needed
    this.branches = this.branches.filter((b) => b.id !== branchId)

    log('Branch deleted:', branchId)
  }

  /**
   * Get the total entry count for a branch including inherited history.
   */
  async getBranchEntryCount(branchId: string | null): Promise<number> {
    if (!this.story.id) return 0

    if (branchId === null) {
      const entries = await database.getStoryEntriesForBranch(this.story.id!, null)
      return entries.length
    }

    const lineage = this.buildBranchLineage(branchId)
    if (lineage.length === 0) return 0

    const forkPositions = await this.getForkEntryPositions(lineage)
    const rootForkPosition = forkPositions.get(lineage[0].id)

    let count = 0
    const mainEntries = await database.getStoryEntriesForBranch(
      this.story.id!,
      null,
      rootForkPosition ?? undefined,
    )
    count += mainEntries.length

    for (let i = 0; i < lineage.length; i++) {
      const branch = lineage[i]
      const childForkPosition =
        i < lineage.length - 1 ? forkPositions.get(lineage[i + 1].id) : undefined
      const entries = await database.getStoryEntriesForBranch(
        this.story.id!,
        branch.id,
        childForkPosition ?? undefined,
      )
      count += entries.length
    }

    return count
  }

  /**
   * Get the branch tree structure for UI display.
   * Returns branches organized by parent-child relationships.
   */
  getBranchTree(): { branch: Branch | null; children: Branch[] }[] {
    // Build tree starting from root (null parent = main branch children)
    const rootBranches = this.branches.filter((b) => b.parentBranchId === null)
    const tree: { branch: Branch | null; children: Branch[] }[] = []

    // Main branch (implicit)
    tree.push({
      branch: null, // null represents main branch
      children: rootBranches,
    })

    // Add all branches with their children
    for (const branch of this.branches) {
      const children = this.branches.filter((b) => b.parentBranchId === branch.id)
      tree.push({ branch, children })
    }

    return tree
  }

  /**
   * Check if we're currently on a COW-enabled branch.
   * Returns true if on a non-main branch with lightweightBranches enabled.
   */
  isCowBranch(): boolean {
    return !!this.story.branch.currentBranchId && settings.experimentalFeatures.lightweightBranches
  }
}
