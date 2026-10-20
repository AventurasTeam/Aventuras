/**
 * The one place that says what a lore change does to the story.
 *
 * All three callers need the same five callbacks and each wrote them out again, with
 * drift: one merged by passing the entry whole, another by copying fourteen fields by hand.
 *
 * Progress reporting is deliberately absent: `LoreManagementCoordinator` wraps these and
 * counts the changes itself, so a callback that also reported would double-count.
 *
 * Imports `story`, which imports this module back through `services/generation`. The cycle
 * is safe only because every access happens inside a callback, never at module scope.
 */

import { story, type RecordOptions } from '#lib/stores/story.svelte.ts'
import { sameBranchScope, type BranchScope } from '#lib/utils/branchScope.ts'
import { ui } from '#lib/stores/ui.svelte.ts'
import { aiService } from '#lib/services/ai/index.ts'
import { database } from '#lib/services/database.ts'
import { pairKeys, scopeToPool } from '#lib/services/duplicates/index.ts'
import { activity } from '#lib/stores/activity.svelte.ts'
import type { Chapter } from '#lib/types/index.ts'
import type {
  LoreManagementCallbacks,
  LoreManagementUICallbacks,
} from './LoreManagementCoordinator'

/**
 * The story branch a session was started for.
 *
 * The callbacks write through the `story` store, which always means the story open *now*,
 * while a session outlives the turn that started it.
 */
export type LoreCallbackScope = BranchScope

/**
 * Refuse a write meant for a branch that is no longer open.
 *
 * A throw, not a skip: the coordinator reports the session failed and it stops here, rather
 * than reporting a tidy-up that wrote nothing.
 */
function assertScope(scope: LoreCallbackScope, action: string): void {
  const current = story.currentScope
  if (current && sameBranchScope(current, scope)) return
  throw new Error(
    `Lore management: refusing to ${action}. The session was started for story ${scope.storyId}` +
      ` (branch ${scope.branchId ?? 'main'}), which is no longer the open one.`,
  )
}

/**
 * `record` says who the session's changes belong to: its origin and the entry they attach to. A
 * function is read at each write, for a session whose chapter is cut after the callbacks exist.
 */
export function buildLoreManagementCallbacks(
  scope: LoreCallbackScope,
  recordOrResolve: RecordOptions | (() => RecordOptions),
): LoreManagementCallbacks {
  const resolve = typeof recordOrResolve === 'function' ? recordOrResolve : () => recordOrResolve
  return {
    onSaveSession: async (writes) => {
      assertScope(scope, 'save the lore management session')
      await story.saveLoreSession(writes, resolve())
    },
    // The user's dismissals and the agent's are the same decision, so they share a table.
    // Addressed by scope directly: no store involved, so there is nothing to be stale.
    getKeptSeparate: async () => {
      const all = await database.getKeptSeparate(scope.storyId, scope.branchId)
      return scopeToPool(all, 'lorebook')
    },
    onKeepSeparate: async (names) => {
      await database.addKeptSeparate(scope.storyId, scope.branchId, 'lorebook', pairKeys(names))
    },
    // Guarded too: a chapter number resolves against whichever story's chapters are loaded.
    // `activityParentId` is the read's own step: the answer's absorbed failure closes it.
    onQueryChapter: async (chapterNumber, question, activityParentId) => {
      assertScope(scope, `read chapter ${chapterNumber}`)
      const answer = await aiService.queryChapter(
        scope.storyId,
        chapterNumber,
        question,
        story.currentBranchChapters,
        story.getChapterEntries.bind(story),
        story.chapterReadBudget,
        activityParentId,
      )
      if (answer.failure && activityParentId) {
        activity.endStep(activityParentId, 'failed', undefined, answer.failure)
      }
      return answer.answer
    },
  }
}

/**
 * Where a session reports its progress.
 *
 * `panel` is the lorebook's own progress state, read by the Active Context panel and by
 * the lorebook views, which go read-only while a run is in flight. `chapterization` is a
 * batch import, where the visible progress belongs to the capitolization it is part of —
 * the lore pass is one line in a longer job.
 */
export type LoreProgressTarget = 'panel' | { onStatus: (status: string | null) => void }

/**
 * The UI half, which all three callers need and each used to write out again.
 *
 * The summary goes to the same place either way: it is the only account of what a run
 * changed, and it outlives the run, so a batch import records it too.
 */
export function buildLoreManagementUICallbacks(
  target: LoreProgressTarget = 'panel',
  /** How a failed chapter session read the story, for Retry to read it the same way. */
  options: { readAfterChapter?: boolean } = {},
): LoreManagementUICallbacks {
  const failed = (error: string, chapter?: Chapter) =>
    ui.setLoreManagementError(
      error,
      chapter
        ? {
            storyId: chapter.storyId,
            branchId: chapter.branchId ?? null,
            chapterId: chapter.id,
            readAfterChapter: options.readAfterChapter ?? true,
          }
        : null,
    )
  if (target === 'panel') {
    return {
      onStart: ui.startLoreManagement.bind(ui),
      onProgress: ui.updateLoreManagementProgress.bind(ui),
      onSummary: ui.setLoreManagementSummary.bind(ui),
      onError: failed,
      onComplete: ui.finishLoreManagement.bind(ui),
    }
  }

  return {
    onStart: () => target.onStatus('Updating lorebook...'),
    onProgress: (message) => target.onStatus(message),
    onSummary: ui.setLoreManagementSummary.bind(ui),
    // The status line and not only the status line: the coordinator clears the UI right
    // after this, and `onComplete` sets the status back to null in the same tick — so a
    // failure written only there is erased before anyone reads it. The stored error
    // outlives the run and is what the lorebook view shows.
    onError: (err, chapter) => {
      target.onStatus(`Lore management failed: ${err}`)
      failed(err, chapter)
    },
    onComplete: () => target.onStatus(null),
  }
}
