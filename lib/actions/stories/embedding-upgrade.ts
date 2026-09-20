import type { DbCtx } from '@/lib/db'

import { updateStorySettings, type UpdateStorySettingsResult } from './update-story-settings'

/** `declineEmbeddingUpgrade` with its DB context bound — the shape UI seams inject. */
export type DeclineEmbeddingUpgradeFn = (
  storyId: string,
  declinedModelId: string,
) => Promise<UpdateStorySettingsResult>

/** "Keep on the current model": records the declined app default so the prompt stops firing. */
export function declineEmbeddingUpgrade(
  storyId: string,
  declinedModelId: string,
  ctx: DbCtx,
): Promise<UpdateStorySettingsResult> {
  return updateStorySettings(storyId, { embedding_upgrade_declined: declinedModelId }, ctx)
}
