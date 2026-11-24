import { asc, eq } from 'drizzle-orm'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { branches, type Branch, type DbCtx } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

export type BranchRow = Pick<Branch, 'id' | 'name' | 'parentBranchId' | 'forkEntryId' | 'createdAt'>

type BranchesState = { storyId: string | null; rows: readonly BranchRow[] }

// One reference for every story not held, so a selector that returns it stays stable.
const EMPTY_ROWS: readonly BranchRow[] = Object.freeze([])

const store = createStore<BranchesState>()(() => ({ storyId: null, rows: EMPTY_ROWS }))

// Advanced by each refresh and by a reset: a read that lands after either is dropped.
let refreshSeq = 0

function rowsOf(state: BranchesState, storyId: string | null): readonly BranchRow[] {
  return storyId != null && state.storyId === storyId ? state.rows : EMPTY_ROWS
}

/**
 * One story's branches by `created_at`, then `id`; runs with no story open. Throws on a read
 * failure.
 */
export async function readStoryBranches(
  db: DbCtx['db'],
  storyId: string,
): Promise<readonly BranchRow[]> {
  const rows = await db
    .select({
      id: branches.id,
      name: branches.name,
      parentBranchId: branches.parentBranchId,
      forkEntryId: branches.forkEntryId,
      createdAt: branches.createdAt,
    })
    .from(branches)
    .where(eq(branches.storyId, storyId))
    .orderBy(asc(branches.createdAt), asc(branches.id))
  return rows
}

function useBranches<T>(storyId: string | null, selector: (rows: readonly BranchRow[]) => T): T {
  return useStore(store, (s) => selector(rowsOf(s, storyId)))
}

export const branchesStore = {
  useBranches,
  getBranches: (storyId: string | null): readonly BranchRow[] => rowsOf(store.getState(), storyId),
  /** Row-fed: replaces the held story and its rows. */
  hydrate: (storyId: string, rows: readonly BranchRow[]): void => store.setState({ storyId, rows }),
  __reset: (): void => {
    refreshSeq += 1
    store.setState({ storyId: null, rows: EMPTY_ROWS })
  },
}

/** Never rejects; a failed read logs and keeps the last rows; a superseded result is dropped. */
export async function refreshBranches(db: DbCtx['db'], storyId: string): Promise<void> {
  const seq = ++refreshSeq
  try {
    const rows = await readStoryBranches(db, storyId)
    if (seq === refreshSeq) store.setState({ storyId, rows })
  } catch (err) {
    logger.error('app.branches_refresh_failed', {
      storyId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
