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

import { story } from '$lib/stores/story.svelte'
import { ui } from '$lib/stores/ui.svelte'
import { aiService } from '$lib/services/ai'
import { database } from '$lib/services/database'
import { pairKeys, scopeToPool } from '$lib/services/duplicates'
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
export interface LoreCallbackScope {
  storyId: string
  branchId: string | null
}

/**
 * Refuse a write meant for a branch that is no longer open.
 *
 * A throw, not a skip: the coordinator reports the session failed and it stops here, rather
 * than reporting a tidy-up that wrote nothing.
 */
function assertScope(scope: LoreCallbackScope, action: string): void {
  const current = story.currentStory
  if (current?.id === scope.storyId && current.currentBranchId === scope.branchId) return
  throw new Error(
    `Lore management: refusing to ${action}. The session was started for story ${scope.storyId}` +
      ` (branch ${scope.branchId ?? 'main'}), which is no longer the open one.`,
  )
}

export function buildLoreManagementCallbacks(scope: LoreCallbackScope): LoreManagementCallbacks {
  return {
    // `addLorebookEntry` assigns its own id, storyId and timestamps over whatever is
    // passed, so handing it the entry whole is both shorter and safer than listing the
    // fields to keep — a field added to `Entry` is carried without touching this.
    onCreateEntry: async (entry) => {
      assertScope(scope, `create "${entry.name}"`)
      await story.addLorebookEntry(entry)
    },
    onUpdateEntry: async (id, updates) => {
      assertScope(scope, `update entry ${id}`)
      await story.updateLorebookEntry(id, updates)
    },
    onDeleteEntry: async (id) => {
      assertScope(scope, `delete entry ${id}`)
      await story.deleteLorebookEntry(id)
    },
    // Survivor first: deleting first loses every source if the insert then fails.
    onMergeEntries: async (entryIds, mergedEntry) => {
      assertScope(scope, `merge into "${mergedEntry.name}"`)
      await story.addLorebookEntry(mergedEntry)
      await story.deleteLorebookEntries(entryIds)
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
    onQueryChapter: async (chapterNumber, question) => {
      assertScope(scope, `read chapter ${chapterNumber}`)
      return aiService.answerChapterQuestion(
        chapterNumber,
        question,
        story.currentBranchChapters,
        story.getChapterEntries.bind(story),
        story.chapterReadBudget,
      )
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
): LoreManagementUICallbacks {
  if (target === 'panel') {
    return {
      onStart: ui.startLoreManagement.bind(ui),
      onProgress: ui.updateLoreManagementProgress.bind(ui),
      onSummary: ui.setLoreManagementSummary.bind(ui),
      onComplete: ui.finishLoreManagement.bind(ui),
    }
  }

  return {
    onStart: () => target.onStatus('Updating lorebook...'),
    onProgress: (message) => target.onStatus(message),
    onSummary: ui.setLoreManagementSummary.bind(ui),
    onComplete: () => target.onStatus(null),
  }
}
