import { useCallback, useEffect, useRef, useState } from 'react'

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
 * patterns/lists.md → Load-older: the first chunk reloads on any query change and whenever
 * `version` changes; `loadMore` appends the next chunk. Nothing loads on scroll. `labelPaths`
 * must be referentially stable, or every render reloads.
 */
export function useHistoryChunks(
  query: Omit<HistoryQuery, 'cursor' | 'limit'>,
  version: unknown,
): HistoryChunks {
  const load = useHistoryLoader()
  const [state, setState] = useState<ChunkState>(LOADING)
  const [attempt, setAttempt] = useState(0)
  const request = useRef(0)
  // Two loadMore calls before a re-render share one closure's state; this stops the second.
  const loadingMore = useRef(false)
  const { branchId, targetTable, targetId, op, search, labelPaths, sort } = query

  useEffect(() => {
    const mine = ++request.current
    loadingMore.current = false
    setState(LOADING)
    load({ branchId, targetTable, targetId, op, search, labelPaths, sort, cursor: null }).then(
      (chunk) => {
        if (request.current === mine)
          setState({ rows: chunk.rows, nextCursor: chunk.nextCursor, status: 'ready' })
      },
      (error: unknown) => {
        if (request.current !== mine) return
        logger.error('app.history_load_failed', { targetTable, targetId, error: message(error) })
        setState({ rows: [], nextCursor: null, status: 'failed' })
      },
    )
    // Unmount and every reload orphan whatever is still in flight.
    return () => {
      request.current += 1
    }
  }, [load, branchId, targetTable, targetId, op, search, labelPaths, sort, version, attempt])

  const loadMore = useCallback(() => {
    if (loadingMore.current || state.status !== 'ready' || state.nextCursor == null) return
    loadingMore.current = true
    const mine = request.current
    const cursor = state.nextCursor
    setState((current) => ({ ...current, status: 'loading-more' }))
    load({ branchId, targetTable, targetId, op, search, labelPaths, sort, cursor }).then(
      (chunk) => {
        if (request.current !== mine) return
        loadingMore.current = false
        setState((current) => ({
          rows: [...current.rows, ...chunk.rows],
          nextCursor: chunk.nextCursor,
          status: 'ready',
        }))
      },
      (error: unknown) => {
        if (request.current !== mine) return
        loadingMore.current = false
        logger.error('app.history_load_more_failed', {
          targetTable,
          targetId,
          error: message(error),
        })
        setState((current) => ({ ...current, status: 'ready' }))
        toast.error(t('history:tab.failed'))
      },
    )
  }, [state, load, branchId, targetTable, targetId, op, search, labelPaths, sort])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    rows: state.rows,
    status: state.status,
    hasMore: state.nextCursor != null,
    loadMore,
    retry,
  }
}
