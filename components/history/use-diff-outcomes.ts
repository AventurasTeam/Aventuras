import { useQueries, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import type { Delta } from '@/lib/db'
import {
  DiffEvictedError,
  type DiffOutcome,
  type HistoryRow,
  type UpdateDelta,
} from '@/lib/history'

import { useDiffLoader, type DiffLoader } from './diff-loader'

type DiffQueryKey = readonly ['diff', string, string]
type DiffQuery = UseQueryOptions<DiffOutcome, Error, DiffOutcome, DiffQueryKey>

// An eviction that overtakes a row's first read rejects it with DiffEvictedError, and TanStack
// joins the invalidation's refetch onto that same fetch, so the read starts again here.
async function populateAfterEvictions(
  loader: DiffLoader,
  delta: UpdateDelta,
): Promise<DiffOutcome> {
  for (;;) {
    try {
      return await loader.populate(delta)
    } catch (error) {
      if (!(error instanceof DiffEvictedError)) throw error
    }
  }
}

const diffKey = (delta: Delta): DiffQueryKey => ['diff', delta.branchId, delta.id]

function peeked(loader: DiffLoader, delta: Delta): DiffOutcome | undefined {
  const entry = loader.peek(delta.branchId, delta.id)
  return entry === undefined ? undefined : { kind: 'entry', entry }
}

const outdated = (loader: DiffLoader, delta: Delta, outcome: DiffOutcome | undefined): boolean =>
  outcome?.kind === 'entry' && !loader.isCurrent(delta.branchId, outcome.entry)

/** Each update row's diff outcome, by delta id; absent while pending, re-reading or failed. */
export function useDiffOutcomes(rows: readonly HistoryRow[]): ReadonlyMap<string, DiffOutcome> {
  const loader = useDiffLoader()
  const client = useQueryClient()
  const updates = useMemo(
    () =>
      rows.map((row) => row.delta).filter((delta): delta is UpdateDelta => delta.op === 'update'),
    [rows],
  )
  const queries = updates.map(
    (delta): DiffQuery => ({
      queryKey: diffKey(delta),
      queryFn: () => populateAfterEvictions(loader, delta),
      initialData: () => peeked(loader, delta),
      // The diff cache owns retention: a query that outlived its tab would miss the eviction.
      gcTime: 0,
      // Only an invalidation makes a diff stale, so `isStale` marks a re-read after an eviction.
      staleTime: Infinity,
      // `isCurrent` knows only the cache's own objects, which sharing rebuilds from the old data.
      structuralSharing: false,
    }),
  )
  // Plain values, so TanStack's structural sharing keeps them stable while no outcome changes.
  const { outcomes, staleBranches } = useQueries({
    queries,
    combine: (results) => {
      const shown: Record<string, DiffOutcome> = {}
      const stale = new Set<string>()
      results.forEach((result, i) => {
        // An evicted row's old outcome is stale prose; canon wants the summary until the re-read.
        if (result.status !== 'success' || result.isStale) return
        const delta = updates[i]
        // A first read an eviction overtook after the cache resolved it lands unstale to TanStack.
        if (outdated(loader, delta, result.data)) stale.add(delta.branchId)
        else shown[delta.id] = result.data
      })
      return { outcomes: shown, staleBranches: [...stale].sort() }
    },
  })
  useEffect(() => {
    // C9: invalidate, never remove; a removal notifies no mounted row.
    function rereadBranch(branchId: string): void {
      void client.invalidateQueries({ queryKey: ['diff', branchId] })
    }
    const unsubscribe = loader.onEvict(rereadBranch)
    // Plus seeds taken at render, which can predate an eviction this subscription missed.
    const stale = new Set(staleBranches)
    for (const delta of updates)
      if (outdated(loader, delta, client.getQueryData<DiffOutcome>(diffKey(delta))))
        stale.add(delta.branchId)
    for (const branchId of stale) rereadBranch(branchId)
    return unsubscribe
  }, [loader, client, updates, staleBranches])
  return useMemo(() => new Map(Object.entries(outcomes)), [outcomes])
}
