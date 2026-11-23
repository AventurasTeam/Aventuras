import { useQueries, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import type { Delta } from '@/lib/db'
import { DiffEvictedError, type DiffOutcome, type HistoryRow } from '@/lib/history'

import { useDiffLoader, type DiffLoader } from './diff-loader'

type DiffQueryKey = readonly ['diff', string, string]
type DiffQuery = UseQueryOptions<DiffOutcome, Error, DiffOutcome, DiffQueryKey>

// An eviction that overtakes a row's first read rejects it with DiffEvictedError, and TanStack
// joins the invalidation's refetch onto that same fetch, so the read starts again here.
async function populateAfterEvictions(loader: DiffLoader, delta: Delta): Promise<DiffOutcome> {
  for (;;) {
    try {
      return await loader.populate(delta)
    } catch (error) {
      if (!(error instanceof DiffEvictedError)) throw error
    }
  }
}

function peeked(loader: DiffLoader, delta: Delta): DiffOutcome | undefined {
  const entry = loader.peek(delta.branchId, delta.id)
  return entry === undefined ? undefined : { kind: 'entry', entry }
}

/** Each update row's resolved diff outcome, by delta id; absent while pending or after a rejection. */
export function useDiffOutcomes(
  branchId: string,
  rows: readonly HistoryRow[],
): ReadonlyMap<string, DiffOutcome> {
  const loader = useDiffLoader()
  const client = useQueryClient()
  const updates = useMemo(
    () => rows.map((row) => row.delta).filter((delta) => delta.op === 'update'),
    [rows],
  )
  const queries = updates.map(
    (delta): DiffQuery => ({
      queryKey: ['diff', branchId, delta.id],
      queryFn: () => populateAfterEvictions(loader, delta),
      initialData: () => peeked(loader, delta),
      // The diff cache owns retention: a query that outlived its tab would miss the eviction.
      gcTime: 0,
    }),
  )
  // A plain record, so TanStack's structural sharing keeps it stable while no outcome changes.
  const byId = useQueries({
    queries,
    combine: (results) => {
      const outcomes: Record<string, DiffOutcome> = {}
      results.forEach((result, i) => {
        if (result.status === 'success') outcomes[updates[i].id] = result.data
      })
      return outcomes
    },
  })
  useEffect(
    () =>
      loader.onEvict((evicted) => {
        // C9: invalidate, never remove; a removal notifies no mounted row.
        if (evicted === branchId) void client.invalidateQueries({ queryKey: ['diff', evicted] })
      }),
    [loader, client, branchId],
  )
  return useMemo(() => new Map(Object.entries(byId)), [byId])
}
