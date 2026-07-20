import { useCallback, useEffect, useRef, useState } from 'react'

import { listInstalledLocal } from '@/lib/embedder'

export type InstalledModelInfo = { id: string; sizeBytes: number }

/**
 * Fetches the installed-local-models list on mount and exposes a `refresh`
 * for callers to re-fetch after an install/remove. Guards against setting
 * state from a resolution that lands after the consumer unmounts.
 */
export function useInstalledModels(
  listInstalled: () => Promise<InstalledModelInfo[]> = listInstalledLocal,
): { installed: InstalledModelInfo[] | null; refresh: () => void } {
  const [installed, setInstalled] = useState<InstalledModelInfo[] | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    void listInstalled().then((rows) => {
      if (mountedRef.current) setInstalled(rows)
    })
  }, [listInstalled])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { installed, refresh }
}
