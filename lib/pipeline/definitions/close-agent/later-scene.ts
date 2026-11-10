import { and, eq, gt } from 'drizzle-orm'

import { readEntryPosition, storyEntries } from '@/lib/db'

import type { ToolContext } from './tool'

/**
 * Ids in the sceneEntities of the branch's ai_reply entries positioned after `endEntryId`. A
 * user_action carries the scene before it forward (data-model.md → Entry metadata shape), so only
 * replies count: the action after E would otherwise hold everyone who dies at E.
 */
export async function charactersInSceneAfter(
  ctx: Pick<ToolContext, 'db' | 'branchId'>,
  endEntryId: string,
): Promise<ReadonlySet<string>> {
  const end = await readEntryPosition(ctx.branchId, endEntryId, ctx.db)
  if (end === null)
    throw new Error(`charactersInSceneAfter: branch ${ctx.branchId} holds no entry ${endEntryId}`)
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
