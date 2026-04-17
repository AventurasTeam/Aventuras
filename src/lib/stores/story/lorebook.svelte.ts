import { database } from '$lib/services/database'
import type { Entry } from '$lib/types'
import { settings } from '../settings.svelte'
import type { StoryStore } from './index.svelte'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Lorebook]', ...args)
  }
}

export class StoryLorebookStore {
  constructor(private story: StoryStore) {}
  lorebookEntries = $state<Entry[]>([])

  /**
   * Add a new lorebook entry.
   * @param entryData - Entry data. branchId is optional and defaults to current branch.
   */
  async addLorebookEntry(
    entryData: Omit<Entry, 'id' | 'storyId' | 'createdAt' | 'updatedAt' | 'branchId'> & {
      branchId?: string | null
    },
  ): Promise<Entry> {
    if (!this.story.id) throw new Error('No story loaded')

    const now = Date.now()
    const entry: Entry = {
      ...entryData,
      id: crypto.randomUUID(),
      storyId: this.story.id!,
      createdAt: now,
      updatedAt: now,
      // Use provided branchId or default to current branch
      branchId: entryData.branchId ?? this.story.branch.currentBranchId,
    }

    await database.addEntry(entry)
    this.lorebookEntries = [...this.lorebookEntries, entry]
    log('Lorebook entry added:', entry.name)
    return entry
  }

  /**
   * Update a lorebook entry.
   */
  async updateLorebookEntry(id: string, updates: Partial<Entry>): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const existing = this.lorebookEntries.find((e) => e.id === id)
    if (!existing) throw new Error('Lorebook entry not found')

    // COW: ensure entity is owned by current branch before updating
    const { entity: owned } = await this.cowLorebookEntry(existing)

    const updatesWithTimestamp = {
      ...updates,
      updatedAt: Date.now(),
    }

    await database.updateEntry(owned.id, updatesWithTimestamp)
    this.lorebookEntries = this.lorebookEntries.map((e) =>
      e.id === owned.id ? { ...e, ...updatesWithTimestamp } : e,
    )
    log('Lorebook entry updated:', owned.id)
  }

  /**
   * Delete a lorebook entry.
   */
  async deleteLorebookEntry(id: string): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    if (settings.experimentalFeatures.lightweightBranches) {
      const existing = this.lorebookEntries.find((e) => e.id === id)
      if (existing) {
        if (existing.branchId === this.story.branch.currentBranchId) {
          await database.markEntryDeleted(id)
        } else {
          const { entity: owned } = await this.cowLorebookEntry(existing)
          await database.markEntryDeleted(owned.id)
        }
      } else {
        await database.deleteEntry(id)
      }
    } else {
      await database.deleteEntry(id)
    }
    this.lorebookEntries = this.lorebookEntries.filter((e) => e.id !== id)
    log('Lorebook entry deleted:', id)
  }

  /**
   * Delete multiple lorebook entries (bulk operation).
   */
  async deleteLorebookEntries(ids: string[]): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    if (settings.experimentalFeatures.lightweightBranches) {
      // COD: process each entry individually for correct tombstone handling
      for (const id of ids) {
        const existing = this.lorebookEntries.find((e) => e.id === id)
        if (existing) {
          if (existing.branchId === this.story.branch.currentBranchId) {
            await database.markEntryDeleted(id)
          } else {
            const { entity: owned } = await this.cowLorebookEntry(existing)
            await database.markEntryDeleted(owned.id)
          }
        } else {
          await database.deleteEntry(id)
        }
      }
    } else {
      await Promise.all(ids.map((id) => database.deleteEntry(id)))
    }
    this.lorebookEntries = this.lorebookEntries.filter((e) => !ids.includes(e.id))
    log('Lorebook entries deleted:', ids.length)
  }

  /**
   * Get a single lorebook entry by ID.
   */
  getLorebookEntry(id: string): Entry | undefined {
    return this.lorebookEntries.find((e) => e.id === id)
  }

  /**
   * Ensure a lorebook entry is owned by the current branch (COW).
   */
  private async cowLorebookEntry(entity: Entry): Promise<{ entity: Entry; wasCowed: boolean }> {
    const branchId = this.story.branch.currentBranchId
    if (
      !branchId ||
      entity.branchId === branchId ||
      !settings.experimentalFeatures.lightweightBranches
    ) {
      return { entity, wasCowed: false }
    }

    const now = Date.now()
    const override: Entry = {
      ...entity,
      id: crypto.randomUUID(),
      branchId,
      overridesId: entity.overridesId ?? entity.id,
      updatedAt: now,
    }
    await database.addEntry(override)
    this.lorebookEntries = this.lorebookEntries.map((e) => (e.id === entity.id ? override : e))
    log(
      'COW: Created lorebook entry override',
      override.name,
      override.id,
      '→ overrides',
      override.overridesId,
    )
    return { entity: override, wasCowed: true }
  }
}
