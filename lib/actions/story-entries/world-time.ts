import { and, eq } from 'drizzle-orm'

import { storyEntries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'

import { applyDeltaAction } from '../delta/apply-delta-action'
import { withKeyLock } from '../delta/key-lock'
import type { DbCtx } from '../types'
import { STORY_ENTRY_REJECTION } from './register'

export type UpdateWorldTimeResult =
  | { status: 'ok' }
  | { status: 'rejected'; reason: string; code?: string }

/**
 * Keyed on this action rather than on `updateStoryEntryMetadata`: what needs
 * serializing is the read-then-decide below, which only this function performs.
 * The pipeline's own dispatches of that kind never pass through here, so a
 * kind-wide key would serialize them against each other for no benefit.
 */
export async function updateEntryWorldTime(
  branchId: string,
  id: string,
  worldTime: number,
  ctx: DbCtx,
): Promise<UpdateWorldTimeResult> {
  return withKeyLock(`updateEntryWorldTime:${branchId}:${id}`, () =>
    updateEntryWorldTimeLocked(branchId, id, worldTime, ctx),
  )
}

async function updateEntryWorldTimeLocked(
  branchId: string,
  id: string,
  worldTime: number,
  ctx: DbCtx,
): Promise<UpdateWorldTimeResult> {
  if (generationStore.isUserEditBlocked())
    return {
      status: 'rejected',
      reason: 'generation in flight',
      code: STORY_ENTRY_REJECTION.inFlight,
    }
  // The ONLY runtime enforcement of the storage invariant (data-model.md ->
  // In-world time tracking): metadata is a `mode: 'json'` column and the forward
  // write path never parses it, so entryMetadataSchema's .min(0) never runs here.
  // Cumulative monotonicity is deliberately NOT checked — a manual edit may move
  // time backwards and the UI flags it.
  if (!Number.isInteger(worldTime) || worldTime < 0)
    return {
      status: 'rejected',
      reason: `worldTime must be a non-negative integer, got ${worldTime}`,
    }
  const [current] = await ctx.db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, id)))
  if (!current)
    return {
      status: 'rejected',
      reason: `story_entries ${branchId}:${id} not found`,
      code: STORY_ENTRY_REJECTION.notFound,
    }
  // Nothing to merge onto: synthesizing the sibling fields would invent data.
  if (current.metadata == null)
    return { status: 'rejected', reason: `entry ${id} has no metadata to edit` }
  // A no-op delta would clear the global (cross-branch) redo stack for nothing.
  if (current.metadata.worldTime === worldTime) return { status: 'ok' }

  const result = await applyDeltaAction(
    {
      action: {
        kind: 'updateStoryEntryMetadata',
        source: 'user_edit',
        // Whole-column replace: a partial would drop the sibling fields.
        payload: { branchId, id, metadata: { ...current.metadata, worldTime } },
      },
      actionId: generateId('act'),
      branchId,
      // Survival anchor (data-model.md -> Survival anchor): the edit belongs to
      // the entry it was made on, so reversing a LATER turn's suffix spares it.
      entryId: id,
    },
    ctx,
  )
  if (result.status !== 'ok') return result
  return { status: 'ok' }
}
