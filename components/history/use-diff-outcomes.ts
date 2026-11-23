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
    }),
  )
  // A plain record, so TanStack's structural sharing keeps it stable while no outcome changes.
  const byId = useQueries({
    queries,
    combine: (results) => {
      const outcomes: Record<string, DiffOutcome> = {}
      results.forEach((result, i) => {
        // An evicted row's old outcome is stale prose; canon wants the summary until the re-read.
        if (result.status === 'success' && !result.isStale) outcomes[updates[i].id] = result.data
      })
      return outcomes
    },
  })
  useEffect(() => {
    // C9: invalidate, never remove; a removal notifies no mounted row.
    function rereadBranch(branchId: string): void {
      void client.invalidateQueries({ queryKey: ['diff', branchId] })
    }
    const unsubscribe = loader.onEvict(rereadBranch)
    // A row seeded at render, before this subscription, can miss an eviction; a seed the cache no
    // longer returns as the same entry marks one, so its branch re-reads as the listener would.
    const missed = new Set<string>()
    for (const delta of updates) {
      const held = client.getQueryData<DiffOutcome>(diffKey(delta))
      if (held?.kind === 'entry' && loader.peek(delta.branchId, delta.id) !== held.entry)
        missed.add(delta.branchId)
    }
    for (const branchId of missed) rereadBranch(branchId)
    return unsubscribe
  }, [loader, client, updates])
  return useMemo(() => new Map(Object.entries(byId)), [byId])
}
