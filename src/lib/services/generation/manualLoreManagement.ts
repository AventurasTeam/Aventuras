/**
 * Running lore management on demand, shared by the Memory view (after a manual chapter)
 * and the Active Context panel's button.
 *
 * A thin wrapper over `LoreManagementCoordinator`, which both automatic paths already use.
 * All it adds is the store reads and the guard against a second concurrent run.
 */

import { story } from '$lib/stores/story.svelte'
import { aiService } from '$lib/services/ai'
import { createLogger } from '$lib/log'
import {
  LoreManagementCoordinator,
  isLoreManagementRunning,
  type LoreSessionResult,
} from './LoreManagementCoordinator'
import { buildLoreManagementCallbacks, buildLoreManagementUICallbacks } from './loreCallbacks'

const log = createLogger('ManualLoreManagement')

/**
 * Run a lore management session against the current story.
 *
 * Returns null when there is no story. Concurrency is the coordinator's to enforce — its
 * lock is what all three callers pass through, and it is authoritative where
 * `ui.loreManagementActive` is not: that flag lingers for two seconds after a run so the
 * user can read the summary.
 */
export async function runManualLoreManagement(): Promise<LoreSessionResult | null> {
  if (
    !story.currentStory ||
    isLoreManagementRunning(story.currentStory.id, story.currentStory.currentBranchId)
  )
    return null

  const currentStory = story.currentStory
  log('Starting manual lore management session', { storyId: currentStory.id })

  const coordinator = new LoreManagementCoordinator({
    runLoreManagement: aiService.runLoreManagement.bind(aiService),
  })

  return coordinator.runSession(
    {
      storyId: currentStory.id,
      currentBranchId: currentStory.currentBranchId,
      lorebookEntries: story.lorebookEntries,
      // This branch's chapters, not every branch's: `answerChapterQuestion` resolves a
      // chapter number against the current branch, so anything else would be listed to the
      // agent and then not found when it asked about it.
      chapters: story.currentBranchChapters,
      // Everything the chapters do not cover. On a story with no chapters this is the
      // whole story, and without it a manual run would be reasoning from the entry list
      // alone — see the note on `recentStory` in LoreManagementService.
      recentEntries: story.getUnchapterizedEntries(),
      mode: currentStory.mode ?? 'adventure',
      pov: story.pov,
      tense: story.tense,
    },
    buildLoreManagementCallbacks(),
    buildLoreManagementUICallbacks(),
  )
}
