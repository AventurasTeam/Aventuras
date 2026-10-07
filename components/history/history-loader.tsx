import { createContext, useContext } from 'react'

import { db } from '@/lib/db'
import {
  loadHistoryChunk,
  type HistoryChunk,
  type HistoryQuery,
  type ScanLinkEnds,
} from '@/lib/history'

/** `scan` is the tab's link-end scan for its current refresh version, shared by its chunks. */
export type HistoryLoader = (query: HistoryQuery, scan: ScanLinkEnds) => Promise<HistoryChunk>

const loadFromDb: HistoryLoader = (query, scan) => loadHistoryChunk(db, query, scan)

const HistoryLoaderContext = createContext<HistoryLoader>(loadFromDb)

/** Swaps the delta-log read for stories and tests, which have no app database. */
export const HistoryLoaderProvider = HistoryLoaderContext.Provider

export function useHistoryLoader(): HistoryLoader {
  return useContext(HistoryLoaderContext)
}
