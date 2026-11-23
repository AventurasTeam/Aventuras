import type { Entity, StoryEntry } from '@/lib/db'
import { currentStoryStore, entitiesStore, entriesStore, type OpenStory } from '@/lib/stores'

import type { PhaseContext, PhaseFailure } from '../types'

export type PerTurnWorkingSet = {
  open: OpenStory
  /** The reader's loaded window, ascending by position — not the whole branch. */
  entries: StoryEntry[]
  entities: Entity[]
}

export type WorkingSetLoad =
  | { ok: true; set: PerTurnWorkingSet }
  | { ok: false; result: PhaseFailure }

/**
 * The working set every per-turn phase reads, behind the two guards none of them
 * may skip. Both are defense-in-depth against store desync: the stores are
 * global and branch-scoped, and a phase that read them for the wrong branch
 * would read no rows and go on to build a silently degenerate prompt rather
 * than fail.
 */
export function loadPerTurnWorkingSet(
  ctx: Pick<PhaseContext, 'storyId' | 'branchId'>,
  phaseName: string,
): WorkingSetLoad {
  const { branchId, storyId } = ctx

  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== branchId || open.storyId !== storyId)
    return {
      ok: false,
      result: {
        status: 'failed',
        error: { kind: 'orchestrator', detail: `${phaseName}: no open story for branch` },
      },
    }

  if (entriesStore.getLoadedBranch() !== branchId)
    return {
      ok: false,
      result: {
        status: 'failed',
        error: {
          kind: 'orchestrator',
          detail: `${phaseName}: entries store loaded for another branch`,
        },
      },
    }

  const entries = [...entriesStore.getEntries(branchId).values()].sort(
    (a, b) => a.position - b.position,
  )
  const entities = [...entitiesStore.getEntities(branchId).values()]

  return { ok: true, set: { open, entries, entities } }
}
