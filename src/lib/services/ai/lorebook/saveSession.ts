/**
 * Writes the changes a lore management session approved.
 *
 * The agent only approves its changes into the ledger; they reach the lorebook here, after it has
 * finished, one write at a time. A write that fails stops the rest, and the ones before it stay.
 */

import type { Entry, LoreChange } from '#lib/types/index.ts'
import type { LoreManagementCallbacks } from '#lib/services/generation/index.ts'
import { describeActivityError, type ActivityReporter } from '#lib/services/activity/index.ts'
import type { LoreManagementResult as SessionResult } from './LoreManagementService'

type LoreWrites = Pick<
  LoreManagementCallbacks,
  'onCreateEntry' | 'onUpdateEntry' | 'onDeleteEntry' | 'onMergeEntries'
>

/**
 * `activityParentId`: where the *Saving changes* step goes, holding one step per write. Without
 * one, or with nothing to write, nothing is recorded.
 */
export async function saveLoreSession(
  session: SessionResult,
  branchId: string | null,
  callbacks: LoreWrites,
  activity: ActivityReporter,
  activityParentId?: string,
  now: () => number = Date.now,
): Promise<LoreChange[]> {
  const changes: LoreChange[] = []
  const mergedAway = new Set(session.merges.flatMap((m) => m.sources.map((e) => e.id)))
  const deletes = session.deletedEntries.filter((entry) => !mergedAway.has(entry.id))
  const pending =
    session.createdEntries.length +
    session.updatedEntries.length +
    session.merges.length +
    deletes.length

  const savingId =
    activityParentId && pending > 0
      ? activity.startStep('Saving changes', { parentId: activityParentId })
      : ''

  // An empty parent would put the step at the root of the newest turn.
  const save = async (label: string, write: () => Promise<void>) => {
    const startedAt = now()
    try {
      await write()
    } catch (error) {
      if (!savingId) throw error
      const reason = describeActivityError(error)
      activity.recordStep(label, {
        parentId: savingId,
        startedAt,
        durationMs: now() - startedAt,
        status: 'failed',
        error: reason,
      })
      activity.endStep(savingId, 'failed', undefined, reason)
      throw error
    }
    if (savingId) {
      activity.recordStep(label, { parentId: savingId, startedAt, durationMs: now() - startedAt })
    }
  }

  for (const entry of session.createdEntries) {
    const newEntry: Entry = { ...entry, id: crypto.randomUUID(), branchId }
    await save(`Created "${newEntry.name}"`, () => callbacks.onCreateEntry(newEntry))
    changes.push({ type: 'create', entry: newEntry })
  }

  for (const entry of session.updatedEntries) {
    await save(`Updated "${entry.name}"`, () => callbacks.onUpdateEntry(entry.id, entry))
    changes.push({ type: 'update', entry })
  }

  // Consolidation is what keeps a lorebook from growing without bound, and it used to
  // stop here: merges and deletes were approved, logged, then dropped, so every run
  // re-proposed the same duplicates it had "already" merged.
  for (const { sources, merged } of session.merges) {
    const mergedEntry = { ...merged, id: crypto.randomUUID(), branchId }
    await save(`Merged ${sources.length} into "${mergedEntry.name}"`, () =>
      callbacks.onMergeEntries(
        sources.map((e) => e.id),
        mergedEntry,
      ),
    )
    changes.push({ type: 'merge', entry: mergedEntry, mergedFrom: sources.map((e) => e.id) })
  }

  for (const entry of deletes) {
    await save(`Deleted "${entry.name}"`, () => callbacks.onDeleteEntry(entry.id))
    changes.push({ type: 'delete', previous: entry })
  }

  activity.endStep(
    savingId,
    'done',
    `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`,
  )
  return changes
}
