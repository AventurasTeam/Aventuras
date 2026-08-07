import type { Entity, StoryEntry } from '@/lib/db'
import { currentStoryStore, entitiesStore, entriesStore, type OpenStory } from '@/lib/stores'

import type { PhaseContext, PhaseResult } from '../types'

export type PerTurnWorkingSet = {
  open: OpenStory
  /** The branch's entries, ascending by position. */
  entries: StoryEntry[]
  entities: Entity[]
}

export type WorkingSetLoad =
  | { ok: true; set: PerTurnWorkingSet }
  | { ok: false; result: Extract<PhaseResult, { status: 'failed' }> }

/**
 * The working set every per-turn phase reads, behind the two guards none of them
 * may skip. Both are defense-in-depth against store desync: the stores are
 * global and branch-scoped, and a phase that read them for the wrong branch
 * would filter every row away and go on to build a silently degenerate prompt
 * rather than fail. `label` prefixes the failure detail with the phase's name.
 */
export function loadPerTurnWorkingSet(
  ctx: Pick<PhaseContext, 'storyId' | 'branchId'>,
  label: string,
): WorkingSetLoad {
  const { branchId, storyId } = ctx

  const open = currentStoryStore.getCurrentStory()
  if (!open || open.branchId !== branchId || open.storyId !== storyId)
    return {
      ok: false,
      result: {
        status: 'failed',
        error: { kind: 'orchestrator', detail: `${label}: no open story for branch` },
      },
    }

  if (entriesStore.getLoadedBranch() !== branchId)
    return {
      ok: false,
      result: {
        status: 'failed',
        error: {
          kind: 'orchestrator',
          detail: `${label}: entries store loaded for another branch`,
        },
      },
    }

  const entries = [...entriesStore.getEntries().values()]
    .filter((e) => e.branchId === branchId)
    .sort((a, b) => a.position - b.position)
  const entities = [...entitiesStore.getEntities().values()].filter((e) => e.branchId === branchId)

  return { ok: true, set: { open, entries, entities } }
}
