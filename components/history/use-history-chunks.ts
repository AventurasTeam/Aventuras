import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { logger } from '@/lib/diagnostics'
import { HISTORY_CHUNK_SIZE, type HistoryQuery, type HistoryRow } from '@/lib/history'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

import { useHistoryLoader, type HistoryLoader } from './history-loader'

export type HistoryStatus = 'loading' | 'ready' | 'loading-more' | 'failed'

type Names = Readonly<Record<string, string>>

type ChunkState = {
  rows: readonly HistoryRow[]
  names: Names
  nextCursor: number | null
  status: HistoryStatus
}

const NO_NAMES: Names = {}

const LOADING: ChunkState = { rows: [], names: NO_NAMES, nextCursor: null, status: 'loading' }

type Request = {
  load: HistoryLoader
  query: Omit<HistoryQuery, 'cursor' | 'limit'>
  attempt: number
}

export type HistoryChunks = {
  rows: readonly HistoryRow[]
  /** Every loaded chunk's `names`, merged. */
  names: Readonly<Record<string, string>>
  status: HistoryStatus
  hasMore: boolean
  loadMore: () => void
  retry: () => void
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * patterns/lists.md → Load-older: a query change reloads from the first chunk. A `version` identity
 * change refetches as many rows as are loaded and swaps them in, keeping the shown rows meanwhile
 * and running a `loadMore` pressed meanwhile once it lands. `version` must be memoized; a fresh
 * one per render never settles.
 */
export function useHistoryChunks(
  query: Omit<HistoryQuery, 'cursor' | 'limit'>,
  version: unknown,
): HistoryChunks {
  const load = useHistoryLoader()
  const [applied, setApplied] = useState<(ChunkState & { for: Request }) | null>(null)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  // Two loadMore calls before a re-render share one closure's state; this stops the second.
  const loadingMore = useRef(false)
  // A refresh replaces the rows, so a loadMore meanwhile would append to stale ones: it waits.
  const refreshing = useRef(false)
  const queuedMore = useRef(false)
  const { branchId, targetTable, targetId, op, search, sort } = query
  const request = useMemo<Request>(
    () => ({
      load,
      query: { branchId, targetTable, targetId, op, search, sort },
      attempt,
    }),
    [load, branchId, targetTable, targetId, op, search, sort, attempt],
  )
  // A superseded read can still land between the new request's commit and the effect cleanup
  // that orphans it, so rows carry the request they were read for and show only under it.
  const state: ChunkState = applied?.for === request ? applied : LOADING
  const appliedRef = useRef(applied)
  useEffect(() => {
    appliedRef.current = applied
  }, [applied])

  const more = useCallback((from: Request, cursor: number) => {
    loadingMore.current = true
    const mine = generation.current
    setApplied((current) => current && { ...current, status: 'loading-more' })
    from.load({ ...from.query, cursor }).then(
      (chunk) => {
        if (generation.current !== mine) return
        loadingMore.current = false
        setApplied(
          (current) =>
            current && {
              ...current,
              rows: [...current.rows, ...chunk.rows],
              names: { ...current.names, ...chunk.names },
              nextCursor: chunk.nextCursor,
              status: 'ready',
            },
        )
      },
      (error: unknown) => {
        if (generation.current !== mine) return
        loadingMore.current = false
        logger.error('app.history_load_more_failed', {
          targetTable: from.query.targetTable,
          targetId: from.query.targetId,
          error: message(error),
        })
        setApplied((current) => current && { ...current, status: 'ready' })
        toast.error(t('history:tab.failed'))
      },
    )
  }, [])

  // Read the query only through `request`: its identity is what resets the rows.
  useEffect(() => {
    const mine = ++generation.current
    // Same request, so only `version` moved: the rows stay up until the refetch replaces them.
    const kept = appliedRef.current?.for === request ? appliedRef.current : null
    const refresh = kept != null && kept.status !== 'failed'
    // The cleanup orphaned any loadMore in flight; under a refresh it runs again once it lands.
    queuedMore.current = refresh && (queuedMore.current || kept.status === 'loading-more')
    refreshing.current = refresh
    loadingMore.current = false
    const settle = (cursor: number | null) => {
      refreshing.current = false
      const queued = queuedMore.current
      queuedMore.current = false
      if (queued && cursor != null) more(request, cursor)
    }
    const limit = refresh ? Math.max(HISTORY_CHUNK_SIZE, kept.rows.length) : undefined
    request.load({ ...request.query, cursor: null, ...(limit != null ? { limit } : {}) }).then(
      (chunk) => {
        if (generation.current !== mine) return
        setApplied({
          for: request,
          rows: chunk.rows,
          names: chunk.names,
          nextCursor: chunk.nextCursor,
          status: 'ready',
        })
        settle(chunk.nextCursor)
      },
      (error: unknown) => {
        if (generation.current !== mine) return
        logger.error('app.history_load_failed', {
          targetTable: request.query.targetTable,
          targetId: request.query.targetId,
          error: message(error),
        })
        setApplied(
          refresh
            ? { ...kept, status: 'ready' }
            : { for: request, rows: [], names: NO_NAMES, nextCursor: null, status: 'failed' },
        )
        settle(refresh ? kept.nextCursor : null)
      },
    )
    // Unmount and every reload orphan whatever is still in flight.
    return () => {
      generation.current += 1
    }
  }, [request, version, more])

  const loadMore = useCallback(() => {
    if (state.nextCursor == null) return
    if (refreshing.current) {
      queuedMore.current = true
      setApplied((current) => current && { ...current, status: 'loading-more' })
      return
    }
    if (loadingMore.current || state.status !== 'ready') return
    more(request, state.nextCursor)
  }, [state, request, more])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    rows: state.rows,
    names: state.names,
    status: state.status,
    hasMore: state.nextCursor != null,
    loadMore,
    retry,
  }
}
