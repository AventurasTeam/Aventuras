import { createContext, useContext } from 'react'

import { diffCache, type DiffCache } from '@/lib/history'

export type DiffLoader = Pick<DiffCache, 'peek' | 'populate' | 'onEvict'>

const DiffLoaderContext = createContext<DiffLoader>(diffCache)

/** Swaps the diff cache for stories and tests, which have no app database. */
export const DiffLoaderProvider = DiffLoaderContext.Provider

export function useDiffLoader(): DiffLoader {
  return useContext(DiffLoaderContext)
}
