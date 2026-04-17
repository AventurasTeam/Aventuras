import { database } from '$lib/services/database'
import type { StoryBeat } from '$lib/types'
import { settings } from '../settings.svelte'
import type { StoryStore } from './index.svelte'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-StoryBeat]', ...args)
  }
}

export class StoryStoryBeatStore {
  constructor(private story: StoryStore) {}

  storyBeats = $state<StoryBeat[]>([])

  get pendingQuests(): StoryBeat[] {
    return this.storyBeats.filter((b) => b.status === 'pending' || b.status === 'active')
  }

  // Add a story beat
  async addStoryBeat(
    title: string,
    type: StoryBeat['type'],
    description?: string,
  ): Promise<StoryBeat> {
    if (!this.story.id) throw new Error('No story loaded')

    const beat: StoryBeat = {
      id: crypto.randomUUID(),
      storyId: this.story.id!,
      title,
      description: description ?? null,
      type,
      status: 'pending',
      triggeredAt: null,
      resolvedAt: null,
      metadata: null,
      branchId: this.story.branch.currentBranchId,
    }

    await database.addStoryBeat(beat)
    this.storyBeats = [...this.storyBeats, beat]
    return beat
  }

  // Update a story beat
  async updateStoryBeat(id: string, updates: Partial<StoryBeat>): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const existing = this.storyBeats.find((b) => b.id === id)
    if (!existing) throw new Error('Story beat not found')

    const resolvedUpdates: Partial<StoryBeat> = { ...updates }
    if (updates.status) {
      if (updates.status === 'completed' || updates.status === 'failed') {
        if (updates.resolvedAt === undefined) {
          resolvedUpdates.resolvedAt = Date.now()
        }
      } else if (updates.resolvedAt === undefined) {
        resolvedUpdates.resolvedAt = null
      }
    }

    // COW: ensure entity is owned by current branch before updating
    const { entity: owned } = await this.cowStoryBeat(existing)
    await database.updateStoryBeat(owned.id, resolvedUpdates)
    this.storyBeats = this.storyBeats.map((b) =>
      b.id === owned.id ? { ...b, ...resolvedUpdates } : b,
    )
  }

  // Delete a story beat
  async deleteStoryBeat(id: string): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const existing = this.storyBeats.find((b) => b.id === id)
    if (!existing) throw new Error('Story beat not found')

    if (settings.experimentalFeatures.lightweightBranches) {
      if (existing.branchId === this.story.branch.currentBranchId) {
        await database.markStoryBeatDeleted(id)
      } else {
        const { entity: owned } = await this.cowStoryBeat(existing)
        await database.markStoryBeatDeleted(owned.id)
      }
    } else {
      await database.deleteStoryBeat(id)
    }
    this.storyBeats = this.storyBeats.filter((b) => b.id !== id)
  }

  /**
   * Ensure a story beat is owned by the current branch (COW).
   */
  async cowStoryBeat(entity: StoryBeat): Promise<{ entity: StoryBeat; wasCowed: boolean }> {
    const branchId = this.story.branch.currentBranchId
    if (
      !branchId ||
      entity.branchId === branchId ||
      !settings.experimentalFeatures.lightweightBranches
    ) {
      return { entity, wasCowed: false }
    }

    const override: StoryBeat = {
      ...entity,
      id: crypto.randomUUID(),
      branchId,
      overridesId: entity.overridesId ?? entity.id,
    }
    await database.addStoryBeat(override)
    this.storyBeats = this.storyBeats.map((b) => (b.id === entity.id ? override : b))
    log(
      'COW: Created story beat override',
      override.title,
      override.id,
      '→ overrides',
      override.overridesId,
    )
    return { entity: override, wasCowed: true }
  }
}
