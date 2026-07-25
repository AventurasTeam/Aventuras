import {
  ensureSuggestionRefreshPipelineRegistered,
  runPipeline,
  SUGGESTION_REFRESH_KIND,
  type RunCtx,
  type SuggestionRefreshInput,
} from '@/lib/pipeline'

import type { DbCtx } from '../types'

// The re-roll trigger (reader-composer.md → Next-turn suggestions). Returns
// runPipeline's result verbatim so the caller sees the self-block rejection —
// a second ⟳ while one is loading is a no-op, not an error.
export async function refreshSuggestions(
  ids: { storyId: string; branchId: string },
  input: SuggestionRefreshInput,
  ctx: DbCtx,
): ReturnType<typeof runPipeline> {
  ensureSuggestionRefreshPipelineRegistered()

  // No shared actionId with anything: the re-roll is its own CTRL-Z unit.
  const runCtx: RunCtx = {
    storyId: ids.storyId,
    branchId: ids.branchId,
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
    inputs: input,
  }
  return runPipeline(SUGGESTION_REFRESH_KIND, runCtx)
}
