export type EmbeddingUpgradePromptInput = {
  storyId: string | null
  storyModelId: string | null
  swapTarget: string | null
  declined: string | null
  appDefault: string | null
  swapRunning: boolean
  deferred: boolean
  recoveryActive: boolean
}

/**
 * retrieval.md → The story-open upgrade prompt. Compares model ids only: the
 * same weights served locally or by a provider are one vector space.
 */
export function embeddingUpgradePromptOpen(input: EmbeddingUpgradePromptInput): boolean {
  if (input.storyId == null || input.storyModelId == null) return false
  // Untrimmed: Keep records the raw default, so a trimmed compare could never silence it.
  const appDefault = input.appDefault
  if (appDefault == null || appDefault.trim() === '') return false
  if (input.storyModelId === appDefault) return false
  if (input.swapTarget != null || input.swapRunning) return false
  if (input.declined === appDefault) return false
  if (input.deferred) return false
  if (input.recoveryActive) return false
  return true
}

export type UpgradePromptLatch = { evaluatedSeq: number; promptSeq: number | null }

export const UPGRADE_PROMPT_LATCH_INITIAL: UpgradePromptLatch = {
  evaluatedSeq: 0,
  promptSeq: null,
}

/** Gate read once per open (retrieval.md); a default moved mid-session waits for the next open. */
export function latchUpgradePrompt(
  latch: UpgradePromptLatch,
  openSeq: number,
  gateOpen: boolean,
): UpgradePromptLatch {
  if (openSeq === latch.evaluatedSeq) return latch
  return { evaluatedSeq: openSeq, promptSeq: gateOpen ? openSeq : null }
}

export function upgradePromptShown(
  latch: UpgradePromptLatch,
  openSeq: number,
  gateOpen: boolean,
): boolean {
  return latch.promptSeq === openSeq && gateOpen
}

/** Any answer ends this open's prompt, Upgrade too: cancelling the swap dialog won't re-raise. */
export function dismissUpgradePrompt(latch: UpgradePromptLatch): UpgradePromptLatch {
  return latch.promptSeq == null ? latch : { ...latch, promptSeq: null }
}
