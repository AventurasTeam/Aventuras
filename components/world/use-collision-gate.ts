import { gateDisabledReason } from '@/components/compounds/generation-gate-copy'
import { useStoryGenerationGate } from '@/components/story-settings/generation-run'

/** Why Resolve and the collision dialog's submits are blocked right now; undefined while open. */
export function useCollisionGate(
  storyId: string | undefined,
  branchId: string,
): string | undefined {
  const { editBlocked, gateReason } = useStoryGenerationGate(storyId, branchId)
  return gateDisabledReason(editBlocked, gateReason)
}
