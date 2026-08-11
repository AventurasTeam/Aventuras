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
import { branchScopeKey } from '$lib/utils/branchScope'

const log = createLogger('LoreManagementCoordinator')

/** How long the completion message stays up after the run is over. */
const COMPLETION_LINGER_MS = 2000

export interface LoreManagementCallbacks {
  onCreateEntry: (entry: Entry) => Promise<void>
  onUpdateEntry: (id: string, updates: Partial<Entry>) => Promise<void>
  onDeleteEntry: (id: string) => Promise<void>
  onMergeEntries: (entryIds: string[], mergedEntry: Entry) => Promise<void>
  onQueryChapter?: (chapterNumber: number, question: string) => Promise<string>
  /**
   * Pairs already declared distinct, by the user or by an earlier run.
   *
   * Without this the agent re-argues every group the user has closed by hand, and its own
   * `keep_separate` lasts only until the session ends.
   */
  getKeptSeparate?: () => Promise<ReadonlySet<string>>
  /** Persist a `keep_separate` decision so the next run inherits it. */
  onKeepSeparate?: (names: string[]) => Promise<void>
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
   * Was hardcoded to `[]` on every path: defensible right after a chapter is written,
   * wrong on a story with no chapters, where it is the whole story.
   */
  recentEntries: StoryEntry[]
  mode: StoryMode
  pov: POV
  tense: Tense
  /** The story's own summarization threshold, which the recent-story budget scales with. */
  tokenThreshold?: number
}

export interface LoreManagementDependencies {
  runLoreManagement: (
    storyId: string,
    branchId: string | null,
    entries: Entry[],
    recentMessages: StoryEntry[],
    chapters: Chapter[],
    callbacks: LoreManagementCallbacks,
    mode: StoryMode,
    pov?: POV,
    tense?: Tense,
    tokenThreshold?: number,
  ) => Promise<LoreManagementResult>
}

export interface LoreSessionResult {
  completed: boolean
  result?: LoreManagementResult
  changeCount: number
  /** Nothing ran: another session already holds this story. See `runningStories`. */
  skipped?: boolean
}

/**
 * Branches with a session in flight.
 *
 * Two agents on one lorebook would write over each other: each takes an index snapshot at
 * the start and edits by index, so the second one's writes land on entries the first has
 * already merged or deleted. Three callers can start a session — the background task after
 * a chapter, the batch importer, and the manual button — and they do not see each other,
 * so the lock lives here, at the one funnel they all pass through, rather than in a UI flag
 * only one of them checked.
 *
 * Keyed by **branch**, not by story: a branch has its own resolved view of the entries, so
 * two branches of one story are two lorebooks and can be tidied at the same time.
 *
 * Module scope, not instance: each caller builds its own coordinator.
 */
const runningBranches = new Set<string>()

/**
 * The pending `onComplete`, so a finished session cannot clear a running one's UI.
 *
 * The lock is released before the linger elapses, deliberately, so a session starting
 * inside those two seconds would inherit the previous one's timer. Module scope like the
 * lock: each caller builds its own coordinator.
 */
let completionTimer: ReturnType<typeof setTimeout> | null = null

/** Whether a lore management session is running for this story branch. */
export function isLoreManagementRunning(storyId: string, branchId: string | null): boolean {
  return runningBranches.has(branchScopeKey(storyId, branchId))
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
    const key = branchScopeKey(input.storyId, input.currentBranchId)
    if (runningBranches.has(key)) {
      log('Session already running for this branch, skipping', { key })
      return { completed: false, changeCount: 0, skipped: true }
    }
    runningBranches.add(key)

    log('Starting lore management session', { key })

    // The previous run's linger, if it is still counting down. Firing it now would report
    // the lorebook idle while this session is writing to it.
    if (completionTimer) {
      clearTimeout(completionTimer)
      completionTimer = null
    }
    uiCallbacks?.onStart()

    let changeCount = 0
    const bumpChanges = (delta = 1) => {
      changeCount += delta
      return changeCount
    }

    // The completion message is left up for a moment, but the lock is not: it is released
    // as soon as the writes are done, so the next run is not blocked by a UI delay.
    const finishUI = () => {
      if (!uiCallbacks) return
      if (completionTimer) clearTimeout(completionTimer)
      completionTimer = setTimeout(() => {
        completionTimer = null
        uiCallbacks.onComplete()
      }, COMPLETION_LINGER_MS)
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
          getKeptSeparate: callbacks.getKeptSeparate,
          onKeepSeparate: callbacks.onKeepSeparate,
        },
        input.mode,
        input.pov,
        input.tense,
        input.tokenThreshold,
      )

      log('Lore management complete', {
        changesCount: result.changes.length,
        summary: result.summary,
      })

      uiCallbacks?.onProgress(`Complete: ${result.summary}`, result.changes.length)
      uiCallbacks?.onSummary?.(result.summary, result.changes.length)
      finishUI()

      return {
        completed: true,
        result,
        changeCount: result.changes.length,
      }
    } catch (error) {
      log('Lore management failed', error)

      // Still clear the UI state: a failed run must not leave the lorebook read-only.
      finishUI()

      return {
        completed: false,
        changeCount,
      }
    } finally {
      runningBranches.delete(key)
    }
  }
}
