import { and, eq } from 'drizzle-orm'

import { MAX_WORLD_TIME_SECONDS } from '@/lib/calendar'
import { storyEntries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { generationStore } from '@/lib/stores'

import { applyDeltaAction } from '../delta/apply-delta-action'
import { withKeyLock } from '../delta/key-lock'
import type { DbCtx } from '../types'
import type { StoryEntryRejection } from './operational'
import { STORY_ENTRY_REJECTION, type StoryEntryRejectionCode } from './register'

export type UpdateWorldTimeResult = { status: 'ok' } | StoryEntryRejection

function rejected(code: StoryEntryRejectionCode, reason: string): StoryEntryRejection {
  return { status: 'rejected', reason, code }
}

function inFlight(): StoryEntryRejection {
  return rejected(STORY_ENTRY_REJECTION.inFlight, 'generation in flight')
}

/**
 * Shared by every ungated entry-metadata writer, so their read-then-decide
 * sections serialize against each other. Keyed per ROW rather than per action:
 * two writers with different action names but the same target row are exactly
 * the pair that must not interleave.
 *
 * Must not be reused as the key of any lock held around a call into one of
 * these functions — `withKeyLock` is not reentrant, so the inner call would
 * await the outer's own promise and deadlock. `applyDeltaAction` locks under a
 * `promoteStagedEntity:` prefix for that reason.
 */
export function entryMetadataLockKey(branchId: string, id: string): string {
  return `entryMetadata:${branchId}:${id}`
}

/**
 * The lock covers ungated writer vs. ungated writer. Pipeline dispatches of
 * `updateStoryEntryMetadata` do not take it — they are kept apart from these by
 * `hard-gate`, which `isUserEditBlocked` rejects against. What protects a
 * pipeline writer's own stale `tail` snapshot is not the lock but the handler's
 * partial merge (register.ts), since its read happens before the transaction.
 */
export async function updateEntryWorldTime(
  branchId: string,
  id: string,
  worldTime: number,
  ctx: DbCtx,
): Promise<UpdateWorldTimeResult> {
  return withKeyLock(entryMetadataLockKey(branchId, id), () =>
    updateEntryWorldTimeLocked(branchId, id, worldTime, ctx),
  )
}

async function updateEntryWorldTimeLocked(
  branchId: string,
  id: string,
  worldTime: number,
  ctx: DbCtx,
): Promise<UpdateWorldTimeResult> {
  if (generationStore.isUserEditBlocked()) return inFlight()
  // The only runtime check on this edit path (data-model.md -> In-world time
  // tracking): metadata is a `mode: 'json'` column and the forward write path
  // never parses it, so entryMetadataSchema's .min(0) never runs here — it runs
  // only on create-story's opening entry. The upper bound is a render-cost
  // guard, not a domain rule (lib/calendar/limits.ts). Cumulative monotonicity
  // is deliberately NOT checked — a manual edit may move time backwards and the
  // UI flags it.
  if (!Number.isInteger(worldTime) || worldTime < 0 || worldTime > MAX_WORLD_TIME_SECONDS)
    return rejected(
      STORY_ENTRY_REJECTION.invalidWorldTime,
      `worldTime must be an integer in [0, ${MAX_WORLD_TIME_SECONDS}], got ${worldTime}`,
    )
  const [current] = await ctx.db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, id)))
  if (!current)
    return rejected(STORY_ENTRY_REJECTION.notFound, `story_entries ${branchId}:${id} not found`)
  // Nothing to merge onto: synthesizing the sibling fields would invent data.
  if (current.metadata == null)
    return rejected(STORY_ENTRY_REJECTION.noMetadata, `entry ${id} has no metadata to edit`)
  // A no-op delta would clear the global (cross-branch) redo stack for nothing.
  if (current.metadata.worldTime === worldTime) return { status: 'ok' }
  // Re-checked after the awaited read: the gate above is a TOCTOU window, and a
  // hard-gate run starting inside it would race this write.
  if (generationStore.isUserEditBlocked()) return inFlight()

  const result = await applyDeltaAction(
    {
      action: {
        kind: 'updateStoryEntryMetadata',
        source: 'user_edit',
        payload: { branchId, id, metadata: { worldTime } },
      },
      actionId: generateId('act'),
      branchId,
      // Survival anchor (data-model.md -> Survival anchor): the delta's subject
      // is this entry, so reversing a LATER turn's suffix spares it.
      entryId: id,
    },
    ctx,
  )
  // Not branched on applyDeltaAction's reversal code: the re-check above reads the
  // same flag with no await between, so anything reaching here is a write failure.
  if (result.status !== 'ok') return rejected(STORY_ENTRY_REJECTION.deltaFailed, result.reason)
  return { status: 'ok' }
}
