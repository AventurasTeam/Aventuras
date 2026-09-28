import { createContext, useContext } from 'react'

import { db } from '@/lib/db'
import { loadHistoryChunk, type HistoryChunk, type HistoryQuery } from '@/lib/history'

export type HistoryLoader = (query: HistoryQuery) => Promise<HistoryChunk>

const loadFromDb: HistoryLoader = (query) => loadHistoryChunk(db, query)

const HistoryLoaderContext = createContext<HistoryLoader>(loadFromDb)

/** Swaps the delta-log read for stories and tests, which have no app database. */
export const HistoryLoaderProvider = HistoryLoaderContext.Provider

export function useHistoryLoader(): HistoryLoader {
  return useContext(HistoryLoaderContext)
}
