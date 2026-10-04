import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { HISTORY_CHUNK_SIZE, type HistoryQuery } from '@/lib/history'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

import { useHistoryLoader, type HistoryLoader } from './history-loader'

export type HistoryStatus = 'loading' | 'ready' | 'loading-more' | 'failed'

type ChunkState = { rows: readonly Delta[]; nextCursor: number | null; status: HistoryStatus }

const LOADING: ChunkState = { rows: [], nextCursor: null, status: 'loading' }

type Request = {
  load: HistoryLoader
  query: Omit<HistoryQuery, 'cursor' | 'limit'>
  attempt: number
}

export type HistoryChunks = {
  rows: readonly Delta[]
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
 * change refetches as many rows as are loaded and swaps them in, keeping the shown rows meanwhile,
 * so `version` must be memoized; a fresh one per render never settles.
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

  // Read the query only through `request`: its identity is what resets the rows.
  useEffect(() => {
    const mine = ++generation.current
    // Same request, so only `version` moved: the rows stay up until the refetch replaces them.
    const kept = appliedRef.current?.for === request ? appliedRef.current : null
    const refreshing = kept != null && kept.status !== 'failed'
    // A refresh replaces the rows, so a loadMore landing meanwhile would append to stale ones.
    loadingMore.current = refreshing
    const limit = refreshing ? Math.max(HISTORY_CHUNK_SIZE, kept.rows.length) : undefined
    request.load({ ...request.query, cursor: null, ...(limit != null ? { limit } : {}) }).then(
      (chunk) => {
        if (generation.current !== mine) return
        loadingMore.current = false
        setApplied({
          for: request,
          rows: chunk.rows,
          nextCursor: chunk.nextCursor,
          status: 'ready',
        })
      },
      (error: unknown) => {
        if (generation.current !== mine) return
        loadingMore.current = false
        logger.error('app.history_load_failed', {
          targetTable: request.query.targetTable,
          targetId: request.query.targetId,
          error: message(error),
        })
        setApplied(
          refreshing
            ? { ...kept, status: 'ready' }
            : { for: request, rows: [], nextCursor: null, status: 'failed' },
        )
      },
    )
    // Unmount and every reload orphan whatever is still in flight.
    return () => {
      generation.current += 1
    }
  }, [request, version])

  const loadMore = useCallback(() => {
    if (loadingMore.current || state.status !== 'ready' || state.nextCursor == null) return
    loadingMore.current = true
    const mine = generation.current
    const cursor = state.nextCursor
    setApplied((current) => current && { ...current, status: 'loading-more' })
    request.load({ ...request.query, cursor }).then(
      (chunk) => {
        if (generation.current !== mine) return
        loadingMore.current = false
        setApplied(
          (current) =>
            current && {
              ...current,
              rows: [...current.rows, ...chunk.rows],
              nextCursor: chunk.nextCursor,
              status: 'ready',
            },
        )
      },
      (error: unknown) => {
        if (generation.current !== mine) return
        loadingMore.current = false
        logger.error('app.history_load_more_failed', {
          targetTable: request.query.targetTable,
          targetId: request.query.targetId,
          error: message(error),
        })
        setApplied((current) => current && { ...current, status: 'ready' })
        toast.error(t('history:tab.failed'))
      },
    )
  }, [state, request])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    rows: state.rows,
    status: state.status,
    hasMore: state.nextCursor != null,
    loadMore,
    retry,
  }
}
