/**
 * LoreManagementCoordinator - Orchestrates lore management sessions.
 * Coordinates AI lore management with CRUD callbacks for entry operations.
 */

import type {
  Entry,
  Chapter,
  LoreManagementResult,
  StoryEntry,
  StoryMode,
  POV,
  Tense,
} from '$lib/types'
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
  /**
   * The agent's own account of what it changed, handed over once and kept by the caller.
   *
   * Separate from `onProgress` because progress is transient by design — it is wiped by
   * `onComplete` two seconds later — and this is the only record of what a run did.
   */
  onSummary?: (summary: string, changeCount: number) => void
  onComplete: () => void
}

export interface LoreSessionInput {
  storyId: string
  currentBranchId: string | null
  lorebookEntries: Entry[]
  chapters: Chapter[]
  /**
   * The story after the last chapter — everything the summaries do not cover yet.
   *
   * Was hardcoded to `[]` on every path, which is defensible right after a chapter is
   * written and wrong everywhere else: on a story with no chapters at all it left the
   * agent maintaining a lorebook for a story it could not read.
   */
  recentEntries: StoryEntry[]
  mode: StoryMode
  pov: POV
  tense: Tense
}

export interface LoreManagementDependencies {
  runLoreManagement: (
    storyId: string,
    branchId: string | null,
    entries: Entry[],
    recentMessages: StoryEntry[],
    chapters: Chapter[],
    callbacks: {
      onCreateEntry: (entry: Entry) => Promise<void>
      onUpdateEntry: (id: string, updates: Partial<Entry>) => Promise<void>
      onDeleteEntry: (id: string) => Promise<void>
      onMergeEntries: (entryIds: string[], mergedEntry: Entry) => Promise<void>
      onQueryChapter?: (chapterNumber: number, question: string) => Promise<string>
    },
    mode: StoryMode,
    pov?: POV,
    tense?: Tense,
  ) => Promise<LoreManagementResult>
}

export interface LoreSessionResult {
  completed: boolean
  result?: LoreManagementResult
  changeCount: number
}

export class LoreManagementCoordinator {
  private deps: LoreManagementDependencies

  constructor(deps: LoreManagementDependencies) {
    this.deps = deps
  }

  async runSession(
    input: LoreSessionInput,
    callbacks: LoreManagementCallbacks,
    uiCallbacks?: LoreManagementUICallbacks,
  ): Promise<LoreSessionResult> {
    log('Starting lore management session', { storyId: input.storyId })

    uiCallbacks?.onStart()

    let changeCount = 0
    const bumpChanges = (delta = 1) => {
      changeCount += delta
      return changeCount
    }

    try {
      const result = await this.deps.runLoreManagement(
        input.storyId,
        input.currentBranchId,
        [...input.lorebookEntries], // Clone to avoid mutation issues
        input.recentEntries,
        input.chapters,
        {
          onCreateEntry: async (entry) => {
            await callbacks.onCreateEntry(entry)
            uiCallbacks?.onProgress('Creating entries...', bumpChanges())
          },
          onUpdateEntry: async (id, updates) => {
            await callbacks.onUpdateEntry(id, updates)
            uiCallbacks?.onProgress('Updating entries...', bumpChanges())
          },
          onDeleteEntry: async (id) => {
            await callbacks.onDeleteEntry(id)
            uiCallbacks?.onProgress('Cleaning up entries...', bumpChanges())
          },
          onMergeEntries: async (entryIds, mergedEntry) => {
            await callbacks.onMergeEntries(entryIds, mergedEntry)
            uiCallbacks?.onProgress('Merging entries...', bumpChanges())
          },
          onQueryChapter: callbacks.onQueryChapter,
        },
        input.mode,
        input.pov,
        input.tense,
      )

      log('Lore management complete', {
        changesCount: result.changes.length,
        summary: result.summary,
      })

      uiCallbacks?.onProgress(`Complete: ${result.summary}`, result.changes.length)
      uiCallbacks?.onSummary?.(result.summary, result.changes.length)

      // Give user a moment to see the completion message
      if (uiCallbacks) {
        setTimeout(() => {
          uiCallbacks.onComplete()
        }, 2000)
      }

      return {
        completed: true,
        result,
        changeCount: result.changes.length,
      }
    } catch (error) {
      log('Lore management failed', error)

      // Still call complete to clean up UI state
      if (uiCallbacks) {
        setTimeout(() => {
          uiCallbacks.onComplete()
        }, 2000)
      }

      return {
        completed: false,
        changeCount,
      }
    }
  }
}
