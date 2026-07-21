import { useCallback, useEffect, useRef, useState } from 'react'

import { logger } from '@/lib/diagnostics'
import { listInstalledLocal } from '@/lib/embedder'

export type InstalledModelInfo = { id: string; sizeBytes: number }

export type InstalledModelsState =
  | { status: 'loading' }
  | { status: 'ready'; models: InstalledModelInfo[] }
  | { status: 'error'; message: string }

/**
 * Fetches the installed-local-models list on mount and exposes a `refresh`
 * for callers to re-fetch after an install/remove. Guards against setting
 * state from a resolution that lands after the consumer unmounts.
 *
 * `state` separates loading from empty from failed. Collapsing a failure into
 * an empty list makes installed models render as not-installed, which invites
 * a redundant multi-hundred-megabyte re-download.
 */
export function useInstalledModels(
  listInstalled: () => Promise<InstalledModelInfo[]> = listInstalledLocal,
): { installed: InstalledModelInfo[] | null; state: InstalledModelsState; refresh: () => void } {
  const [state, setState] = useState<InstalledModelsState>({ status: 'loading' })
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    // Generation-gated: a slow mount listing that resolves after a post-install
    // refresh would otherwise overwrite the newer result, rendering the model the
    // user just downloaded as absent and inviting a redundant re-download.
    const requestId = ++requestIdRef.current
    void listInstalled()
      .then((models) => {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setState({ status: 'ready', models })
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('embedder.list_installed_failed', { error: message })
        if (mountedRef.current && requestId === requestIdRef.current) {
          setState({ status: 'error', message })
        }
      })
  }, [listInstalled])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { installed: state.status === 'ready' ? state.models : null, state, refresh }
}
