/**
 * LoreManagementCoordinator - Orchestrates lore management sessions.
 * Coordinates AI lore management with CRUD callbacks for entry operations.
 */

import { story } from '$lib/stores/story/index.svelte'
import { ui } from '$lib/stores/ui.svelte'
import type { Entry, Chapter, LoreManagementResult, StoryMode, POV, Tense } from '$lib/types'
import { aiService } from '../ai'
import { createLogger } from '$lib/log'

const log = createLogger('LoreManagementCoordinator')

export interface LoreManagementCallbacks {
  onCreateEntry: (entry: Entry) => Promise<void>
  onUpdateEntry: (id: string, updates: Partial<Entry>) => Promise<void>
  onDeleteEntry: (id: string) => Promise<void>
  onMergeEntries: (entryIds: string[], mergedEntry: Entry) => Promise<void>
  onQueryChapter?: (chapterNumber: number, question: string) => Promise<string>
}

export interface LoreManagementUICallbacks {
  onStart: () => void
  onProgress: (message: string, changeCount: number) => void
  onComplete: () => void
}

export interface LoreSessionInput {
  storyId: string
  currentBranchId: string | null
  lorebookEntries: Entry[]
  chapters: Chapter[]
  mode: StoryMode
  pov: POV
  tense: Tense
}

export interface LoreSessionResult {
  completed: boolean
  result?: LoreManagementResult
  changeCount: number
}

export class LoreManagementCoordinator {
  async runSession(): Promise<LoreSessionResult> {
    log('Starting lore management session', { storyId: story.id! })

    let changeCount = 0
    const bumpChanges = (delta = 1) => {
      changeCount += delta
      return changeCount
    }

    ui.startLoreManagement()

    try {
      const result = await aiService.runLoreManagement(bumpChanges)

      log('Lore management complete', {
        changesCount: result.changes.length,
        summary: result.summary,
      })

      ui.updateLoreManagementProgress(`Complete: ${result.summary}`, result.changes.length)

      // Give user a moment to see the completion message
      setTimeout(() => {
        ui.finishLoreManagement()
      }, 2000)

      return {
        completed: true,
        result,
        changeCount: result.changes.length,
      }
    } catch (error) {
      log('Lore management failed', error)

      // Still call complete to clean up UI state
      setTimeout(() => {
        ui.finishLoreManagement()
      }, 2000)

      return {
        completed: false,
        changeCount: 0,
      }
    }
  }
}
