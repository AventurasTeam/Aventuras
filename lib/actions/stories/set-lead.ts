import { and, eq } from 'drizzle-orm'

import { entities, stories, storyDefinitionSchema, type DbCtx } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { currentStoryStore, generationStore, rehydrateStories } from '@/lib/stores'

export const LEAD_REJECTION = {
  inFlight: 'in-flight',
  draftStory: 'draft-story',
  wrongBranch: 'wrong-branch',
  notCharacter: 'not-character',
  notActive: 'not-active',
  invalidDefinition: 'invalid-definition',
} as const

export type LeadRejectionCode = (typeof LEAD_REJECTION)[keyof typeof LEAD_REJECTION]

export type SetStoryLeadResult = { status: 'ok' } | { status: 'rejected'; code: LeadRejectionCode }

function refuse(storyId: string, entityId: string, code: LeadRejectionCode): SetStoryLeadResult {
  logger.warn('action_layer.story_lead_rejected', { storyId, entityId, code })
  return { status: 'rejected', code }
}

/**
 * Sets `definition.leadEntityId` to an active character on the story's current branch. `stories`
 * is not delta-logged, so this is a direct write with no CTRL-Z.
 */
export async function setStoryLead(
  storyId: string,
  entityId: string,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<SetStoryLeadResult> {
  const [story] = await ctx.db
    .select({
      status: stories.status,
      definition: stories.definition,
      currentBranchId: stories.currentBranchId,
    })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (!story) throw new Error('Story not found')
  if (story.status === 'draft') return refuse(storyId, entityId, LEAD_REJECTION.draftStory)
  const [target] =
    story.currentBranchId == null
      ? []
      : await ctx.db
          .select({ kind: entities.kind, status: entities.status })
          .from(entities)
          .where(and(eq(entities.branchId, story.currentBranchId), eq(entities.id, entityId)))
  if (!target) return refuse(storyId, entityId, LEAD_REJECTION.wrongBranch)
  if (target.kind !== 'character') return refuse(storyId, entityId, LEAD_REJECTION.notCharacter)
  // wizard.md → Lead requires status='active': a staged or retired character can't lead.
  if (target.status !== 'active') return refuse(storyId, entityId, LEAD_REJECTION.notActive)
  const next = storyDefinitionSchema.safeParse({ ...story.definition, leadEntityId: entityId })
  if (!next.success) return refuse(storyId, entityId, LEAD_REJECTION.invalidDefinition)
  // No await between this gate and the write, so a run starting mid-read cannot slip past.
  if (generationStore.isUserEditBlocked()) return refuse(storyId, entityId, LEAD_REJECTION.inFlight)
  await ctx.runInTransaction([
    ctx.db
      .update(stories)
      .set({ definition: next.data, updatedAt: nowMs })
      .where(eq(stories.id, storyId))
      .toSQL(),
  ])
  const open = currentStoryStore.getCurrentStory()
  if (open?.storyId === storyId) currentStoryStore.set({ ...open, definition: next.data })
  await rehydrateStories(ctx.db)
  return { status: 'ok' }
}
