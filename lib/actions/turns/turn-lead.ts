import { eq } from 'drizzle-orm'

import { readBranchLead, stories, type Entity } from '@/lib/db'
import { needsLead } from '@/lib/world'

import type { DbCtx } from '../types'

/** The branch's lead for a turn, and whether the story needs one the branch lacks. */
export async function turnLeadOf(
  ids: { storyId: string; branchId: string },
  ctx: DbCtx,
): Promise<{ lead: Entity; missing: false } | { lead: null; missing: boolean }> {
  const lead = await readBranchLead(ids.branchId, ctx.db)
  if (lead != null) return { lead, missing: false }
  const [story] = await ctx.db
    .select({ definition: stories.definition })
    .from(stories)
    .where(eq(stories.id, ids.storyId))
  const definition = story?.definition
  return {
    lead: null,
    missing: definition != null && needsLead(definition.mode, definition.narration),
  }
}
