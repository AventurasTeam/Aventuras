import { and, eq, gt } from 'drizzle-orm'

import { readEntryPosition, storyEntries } from '@/lib/db'

import type { ToolContext } from './tool'

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
  const ids = new Set<string>()
  for (const { metadata } of replies) {
    // A hand-edited row may hold anything in its scene; only strings are ids.
    const scene: unknown = metadata?.sceneEntities
    if (!Array.isArray(scene)) continue
    for (const id of scene) if (typeof id === 'string') ids.add(id)
  }
  return ids
}

/**
 * The characters a reply past the task's last turn has in scene: past E for the last part or a
 * chapter-wide task, past the part otherwise, since a later part's reply is newer evidence too.
 */
export async function charactersInSceneAfterTask(
  ctx: Pick<ToolContext, 'db' | 'branchId' | 'taskEntryIds'>,
): Promise<ReadonlySet<string>> {
  const last = ctx.taskEntryIds.at(-1)
  if (last === undefined) throw new Error('charactersInSceneAfterTask: the task was shown no turn')
  return charactersInSceneAfter(ctx, last)
}
