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
 * The per-turn working set, behind two guards no phase may skip: the stores are global and
 * branch-scoped, so a wrong-branch read yields no rows and a silently degenerate prompt.
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
