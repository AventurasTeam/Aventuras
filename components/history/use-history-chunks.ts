import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { HistoryQuery } from '@/lib/history'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

import { useHistoryLoader } from './history-loader'

export type HistoryStatus = 'loading' | 'ready' | 'loading-more' | 'failed'

type ChunkState = { rows: readonly Delta[]; nextCursor: number | null; status: HistoryStatus }

const LOADING: ChunkState = { rows: [], nextCursor: null, status: 'loading' }

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
 * patterns/lists.md → Load-older: reloads on any query or `version` change, not on scroll.
 * `labelPaths` must be referentially stable, or every render reloads.
 */
export function useHistoryChunks(
  query: Omit<HistoryQuery, 'cursor' | 'limit'>,
  version: unknown,
): HistoryChunks {
  const load = useHistoryLoader()
  const [state, setState] = useState<ChunkState>(LOADING)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  // Two loadMore calls before a re-render share one closure's state; this stops the second.
  const loadingMore = useRef(false)
  const { branchId, targetTable, targetId, op, search, labelPaths, sort } = query
  const request = useMemo(
    () => ({
      load,
      query: { branchId, targetTable, targetId, op, search, labelPaths, sort },
      version,
      attempt,
    }),
    [load, branchId, targetTable, targetId, op, search, labelPaths, sort, version, attempt],
  )
  const [shownFor, setShownFor] = useState(request)
  // Reset during render, not in the effect, so the old query's rows never commit under the new one.
  if (shownFor !== request) {
    setShownFor(request)
    setState(LOADING)
  }

  // Read the query only through `request`: its identity is what resets the rows.
  useEffect(() => {
    const mine = ++generation.current
    loadingMore.current = false
    request.load({ ...request.query, cursor: null }).then(
      (chunk) => {
        if (generation.current === mine)
          setState({ rows: chunk.rows, nextCursor: chunk.nextCursor, status: 'ready' })
      },
      (error: unknown) => {
        if (generation.current !== mine) return
        logger.error('app.history_load_failed', {
          targetTable: request.query.targetTable,
          targetId: request.query.targetId,
          error: message(error),
        })
        setState({ rows: [], nextCursor: null, status: 'failed' })
      },
    )
    // Unmount and every reload orphan whatever is still in flight.
    return () => {
      generation.current += 1
    }
  }, [request])

  const loadMore = useCallback(() => {
    if (loadingMore.current || state.status !== 'ready' || state.nextCursor == null) return
    loadingMore.current = true
    const mine = generation.current
    const cursor = state.nextCursor
    setState((current) => ({ ...current, status: 'loading-more' }))
    request.load({ ...request.query, cursor }).then(
      (chunk) => {
        if (generation.current !== mine) return
        loadingMore.current = false
        setState((current) => ({
          rows: [...current.rows, ...chunk.rows],
          nextCursor: chunk.nextCursor,
          status: 'ready',
        }))
      },
      (error: unknown) => {
        if (generation.current !== mine) return
        loadingMore.current = false
        logger.error('app.history_load_more_failed', {
          targetTable: request.query.targetTable,
          targetId: request.query.targetId,
          error: message(error),
        })
        setState((current) => ({ ...current, status: 'ready' }))
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
