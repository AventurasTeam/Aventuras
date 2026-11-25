import { db } from '@/lib/db'
import { currentStoryStore, refreshBranches } from '@/lib/stores'

/**
 * C8: refreshes the branch list only while the forked story is still open, since the store holds
 * one story's rows. A failed read is logged, never surfaced; a reader that mounts re-reads the list.
 */
export function refreshAfterFork(storyId: string): void {
  if (currentStoryStore.getCurrentStory()?.storyId !== storyId) return
  void refreshBranches(db, storyId)
}
