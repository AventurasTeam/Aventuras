/**
 * Writes the changes a lore management session approved.
 *
 * The agent only approves its changes into the ledger; they reach the lorebook here, after it has
 * finished, in one write that lands whole or not at all.
 */

import type { Entry, LoreChange } from '#lib/types/index.ts'
import type { LoreManagementCallbacks, LoreSessionWrites } from '#lib/services/generation/index.ts'
import { describeActivityError, type ActivityReporter } from '#lib/services/activity/index.ts'
import type { LoreManagementResult as SessionResult } from './LoreManagementService'

/**
 * `activityParentId`: where the *Saving changes* step goes. Without one, or with nothing to write,
 * nothing is recorded.
 */
export async function saveLoreSession(
  session: SessionResult,
  branchId: string | null,
  callbacks: Pick<LoreManagementCallbacks, 'onSaveSession'>,
  activity: ActivityReporter,
  activityParentId?: string,
): Promise<LoreChange[]> {
  const mergedAway = new Set(session.merges.flatMap((m) => m.sources.map((e) => e.id)))
  const deletes = session.deletedEntries.filter((entry) => !mergedAway.has(entry.id))
  const creates: Entry[] = session.createdEntries.map((entry) => ({
    ...entry,
    id: crypto.randomUUID(),
    branchId,
  }))
  const merges = session.merges.map(({ sources, merged }) => ({
    sources,
    merged: { ...merged, id: crypto.randomUUID(), branchId } as Entry,
  }))
  const writes: LoreSessionWrites = {
    creates,
    updates: session.updatedEntries,
    merges: merges.map(({ sources, merged }) => ({ sourceIds: sources.map((e) => e.id), merged })),
    deletes: deletes.map((entry) => entry.id),
  }
  const changes: LoreChange[] = [
    ...creates.map((entry): LoreChange => ({ type: 'create', entry })),
    ...session.updatedEntries.map((entry): LoreChange => ({ type: 'update', entry })),
    ...merges.map(({ sources, merged }): LoreChange => ({
      type: 'merge',
      entry: merged,
      mergedFrom: sources.map((e) => e.id),
    })),
    ...deletes.map((entry): LoreChange => ({ type: 'delete', previous: entry })),
  ]
  if (changes.length === 0) return changes

  // An empty parent would put the step at the root of the newest turn.
  const savingId = activityParentId
    ? activity.startStep('Saving changes', { parentId: activityParentId })
    : ''
  try {
    await callbacks.onSaveSession(writes)
  } catch (error) {
    if (savingId) activity.endStep(savingId, 'failed', undefined, describeActivityError(error))
    throw error
  }
  activity.endStep(
    savingId,
    'done',
    `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`,
  )
  return changes
}
