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

export function buildLoreManagementCallbacks(): LoreManagementCallbacks {
  return {
    // `addLorebookEntry` assigns its own id, storyId and timestamps over whatever is
    // passed, so handing it the entry whole is both shorter and safer than listing the
    // fields to keep — a field added to `Entry` is carried without touching this.
    onCreateEntry: async (entry) => {
      await story.addLorebookEntry(entry)
    },
    onUpdateEntry: story.updateLorebookEntry.bind(story),
    onDeleteEntry: story.deleteLorebookEntry.bind(story),
    onMergeEntries: async (entryIds, mergedEntry) => {
      await story.deleteLorebookEntries(entryIds)
      await story.addLorebookEntry(mergedEntry)
    },
    // The user's dismissals and the agent's are the same decision, so they share a table:
    // without this the agent re-argues every group the user closed by hand, and its own
    // `keep_separate` would last only until the session ended.
    getKeptSeparate: async () => {
      const current = story.currentStory
      if (!current) return new Set<string>()
      const all = await database.getKeptSeparate(current.id, current.currentBranchId)
      return scopeToPool(all, 'lorebook')
    },
    onKeepSeparate: async (names) => {
      const current = story.currentStory
      if (!current) return
      await database.addKeptSeparate(
        current.id,
        current.currentBranchId,
        'lorebook',
        pairKeys(names),
      )
    },
    onQueryChapter: async (chapterNumber, question) =>
      aiService.answerChapterQuestion(
        chapterNumber,
        question,
        story.currentBranchChapters,
        story.getChapterEntries.bind(story),
        story.chapterReadBudget,
      ),
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
