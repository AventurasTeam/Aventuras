import { entitiesStore, type OpenStory } from '@/lib/stores'

import type { PhaseContext } from '../types'

// The working-set stores hold one branch: read for a branch they don't hold, they hand a phase an
// empty roster to prompt, reconcile and plan against.
export function storesHoldBranch(
  open: OpenStory | null,
  ctx: Pick<PhaseContext, 'storyId' | 'branchId'>,
): open is OpenStory {
  return (
    open?.branchId === ctx.branchId &&
    open.storyId === ctx.storyId &&
    entitiesStore.getLoadedBranch() === ctx.branchId
  )
}
