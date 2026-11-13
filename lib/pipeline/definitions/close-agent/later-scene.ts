import { and, eq, gt } from 'drizzle-orm'

import { readEntryPosition, storyEntries } from '@/lib/db'

import { strings } from './row-values'
import { lastTaskTurn, type ToolContext } from './tool'

/**
 * Ids in the sceneEntities of the branch's ai_reply entries positioned after `afterEntryId`. A
 * user_action carries the scene before it forward (data-model.md → Entry metadata shape), so only
 * replies count: the action after `afterEntryId` would otherwise hold everyone who dies there.
 */
export async function charactersInSceneAfter(
  ctx: Pick<ToolContext, 'db' | 'branchId'>,
  afterEntryId: string,
): Promise<ReadonlySet<string>> {
  const end = await readEntryPosition(ctx.branchId, afterEntryId, ctx.db)
  if (end === null)
    throw new Error(`charactersInSceneAfter: branch ${ctx.branchId} holds no entry ${afterEntryId}`)
  const replies = await ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, ctx.branchId),
        eq(storyEntries.kind, 'ai_reply'),
        gt(storyEntries.position, end),
      ),
    )
  return new Set(replies.flatMap(({ metadata }) => strings(metadata?.sceneEntities)))
}

/** The characters a reply past the task's last turn has in scene. */
export async function charactersInSceneAfterTask(
  ctx: Pick<ToolContext, 'db' | 'branchId' | 'taskEntryIds'>,
): Promise<ReadonlySet<string>> {
  return charactersInSceneAfter(ctx, lastTaskTurn(ctx))
}
