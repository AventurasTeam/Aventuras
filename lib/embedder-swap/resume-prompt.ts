export type SwapResumePromptInput = {
  storyId: string | null
  swapTarget: string | null
  swapRunning: boolean
  deferredForThisStory: boolean
  recoveryActive: boolean
}

/**
 * retrieval.md → Crash recovery. A pending crash-recovery report goes first: both are
 * app-level alert dialogs, and the report is what explains the interrupted swap.
 */
export function swapResumePromptOpen(input: SwapResumePromptInput): boolean {
  if (input.storyId == null || input.swapTarget == null) return false
  if (input.swapRunning || input.deferredForThisStory) return false
  return !input.recoveryActive
}
