import { database } from '$lib/services/database'
import { eventBus, type CheckpointCreatedEvent } from '$lib/services/events'
import type { Checkpoint } from '$lib/types'
import type { StoryStore } from './index.svelte'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Checkpoint]', ...args)
  }
}

export class StoryCheckpointStore {
  constructor(private story: StoryStore) {}

  checkpoints = $state<Checkpoint[]>([])

  // Create a checkpoint (snapshot of current state)
  async createCheckpoint(name: string): Promise<Checkpoint> {
    if (!this.story.id) throw new Error('No story loaded')

    const lastEntry = this.story.entry.entries[this.story.entry.entries.length - 1]
    if (!lastEntry) throw new Error('No entries to checkpoint')

    const checkpoint: Checkpoint = {
      id: crypto.randomUUID(),
      storyId: this.story.id!,
      name,
      lastEntryId: lastEntry.id,
      lastEntryPreview: lastEntry.content.substring(0, 100),
      entryCount: this.story.entry.entries.length,
      entriesSnapshot: [...this.story.entry.entries],
      charactersSnapshot: [...this.story.character.characters],
      locationsSnapshot: [...this.story.location.locations],
      itemsSnapshot: [...this.story.item.items],
      storyBeatsSnapshot: [...this.story.storyBeat.storyBeats],
      chaptersSnapshot: [...this.story.chapter.chapters],
      timeTrackerSnapshot: this.story.time.timeTracker ? { ...this.story.time.timeTracker } : null,
      lorebookEntriesSnapshot: [...this.story.lorebook.lorebookEntries],
      createdAt: Date.now(),
    }

    await database.createCheckpoint(checkpoint)
    this.checkpoints = [checkpoint, ...this.checkpoints]

    // Save current background for this checkpoint
    if (this.story.image.currentBgImage) {
      log('Saving background for checkpoint:', name)
      await database.saveBackground(
        this.story.id!,
        this.story.branch.currentBranchId,
        checkpoint.id,
        this.story.image.currentBgImage,
      )
    }

    log('Checkpoint created:', name)

    // Emit event
    eventBus.emit<CheckpointCreatedEvent>({
      type: 'CheckpointCreated',
      checkpointId: checkpoint.id,
      name,
    })

    return checkpoint
  }

  /**
   * @deprecated Checkpoint restoration is no longer supported.
   * Use createBranchFromCheckpoint() instead to explore alternate timelines.
   * This prevents data loss issues when restoring across branches.
   */
  async restoreCheckpoint(_checkpointId: string): Promise<void> {
    throw new Error(
      'Checkpoint restoration is no longer supported. ' +
        'To explore alternate paths, create a new branch from a checkpoint instead.',
    )
  }

  // Delete a checkpoint
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    await database.deleteCheckpoint(checkpointId)
    this.checkpoints = this.checkpoints.filter((cp) => cp.id !== checkpointId)
    log('Checkpoint deleted:', checkpointId)
  }
}
