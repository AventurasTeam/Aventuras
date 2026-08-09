/**
 * The one place that says what a lore change does to the story.
 *
 * Every caller of lore management needs the same five callbacks, and each of the three
 * wrote them out again: the background task in `ActionInput`, `chapterizeFromBeginning` in
 * the story store, and the manual run. They had already drifted — one merged by passing the
 * whole entry, another by copying fourteen fields across by hand — which is how a fix to
 * one path silently misses the other two.
 *
 * Progress reporting is deliberately absent: `LoreManagementCoordinator` wraps these and
 * counts the changes itself, so a callback that also reported would double-count.
 */

import { story } from '$lib/stores/story.svelte'
import { aiService } from '$lib/services/ai'
import type { LoreManagementCallbacks } from './LoreManagementCoordinator'

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
