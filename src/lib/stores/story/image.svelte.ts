// src/lib/stores/story/image.svelte.ts
import { database } from '$lib/services/database'
import type { StoryStore } from './index.svelte'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Image]', ...args)
  }
}

export class StoryImageStore {
  constructor(private story: StoryStore) {}

  currentBgImage = $state<string | null>(null)

  async load(storyId: string, branchId: string | null) {
    this.currentBgImage = await database.getBackgroundForBranch(storyId, branchId)
  }

  async updateBackgroundImage(imageData: string | null) {
    if (!this.story.id) throw new Error('No story loaded')

    log('Updating background image...', { hasData: !!imageData })
    this.currentBgImage = imageData

    await database.saveBackground(this.story.id, this.story.branch.currentBranchId, null, imageData)
    log('Background image updated and persisted')
  }

  clear() {
    this.currentBgImage = null
  }
}
