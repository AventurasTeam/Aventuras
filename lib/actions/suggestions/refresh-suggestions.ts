import { CHAPTER_CLOSE_RERUN } from '@/lib/chapters'
import {
  ensureSuggestionRefreshPipelineRegistered,
  runPipeline,
  SUGGESTION_REFRESH_KIND,
  type RunCtxFor,
  type SuggestionRefreshInput,
} from '@/lib/pipeline'
import { generationStore, refreshHeldByRerun } from '@/lib/stores'

import type { DbCtx } from '../types'

// The re-roll trigger (reader-composer.md → Next-turn suggestions). Returns
// runPipeline's result verbatim; 'rejected' is the self-block (a second ⟳ while
// one loads) or the re-run hold below, and neither is an error.
export async function refreshSuggestions(
  ids: { storyId: string; branchId: string },
  input: SuggestionRefreshInput,
  ctx: DbCtx,
): ReturnType<typeof runPipeline> {
  // A chip delta above a re-run's floor would turn its CTRL-Z into an undone close.
  if (refreshHeldByRerun(generationStore.getTxState(), ids.branchId))
    return { outcome: 'rejected', blockedBy: CHAPTER_CLOSE_RERUN }
  ensureSuggestionRefreshPipelineRegistered()

  // No shared actionId with anything: the re-roll is its own CTRL-Z unit.
  const runCtx: RunCtxFor<typeof SUGGESTION_REFRESH_KIND> = {
    storyId: ids.storyId,
    branchId: ids.branchId,
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
    inputs: input,
  }
  return runPipeline(SUGGESTION_REFRESH_KIND, runCtx)
}
