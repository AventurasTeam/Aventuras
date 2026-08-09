/**
 * Running lore management on demand.
 *
 * The agent otherwise only runs as a background task, hanging off chapter creation, which
 * means the one moment a user wants it — having just looked at a lorebook full of near
 * duplicates — is the moment they cannot ask for it. This is that entry point, shared by
 * the Memory view (after a manual chapter) and the Active Context panel's button.
 *
 * It is a thin wrapper over `LoreManagementCoordinator`, which is what the two automatic
 * paths already use: the manual path once had its own copy of the session loop, its own
 * progress counting and its own set of CRUD callbacks, and they drifted from the others.
 * All this adds is the store reads and the guard against a second concurrent run.
 */

import { story } from '$lib/stores/story.svelte'
import { ui } from '$lib/stores/ui.svelte'
import { aiService } from '$lib/services/ai'
import { createLogger } from '$lib/log'
import { LoreManagementCoordinator, type LoreSessionResult } from './LoreManagementCoordinator'
import { buildLoreManagementCallbacks } from './loreCallbacks'

const log = createLogger('ManualLoreManagement')

/**
 * Run a lore management session against the current story.
 *
 * Returns null when there is no story, or when a session is already running — two agents
 * editing the same lorebook would write over each other, since both hold indices into the
 * snapshot they started from.
 */
export async function runManualLoreManagement(): Promise<LoreSessionResult | null> {
  if (!story.currentStory || ui.loreManagementActive) return null

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
    {
      onStart: ui.startLoreManagement.bind(ui),
      onProgress: ui.updateLoreManagementProgress.bind(ui),
      onSummary: ui.setLoreManagementSummary.bind(ui),
      onComplete: ui.finishLoreManagement.bind(ui),
    },
  )
}
