import { useCallback, useEffect, useState } from 'react'

import { resetAppSettings } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'

import { runBootstrap } from './bootstrap'

export type BootPhase = 'loading' | 'config-corrupt' | 'ready'

export function useBootstrap(ready: boolean): {
  phase: BootPhase
  resetSettings: () => Promise<void>
} {
  const [phase, setPhase] = useState<BootPhase>('loading')

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void runBootstrap({ db, runInTransaction })
      .then((r) => {
        if (!cancelled) setPhase(r.status === 'config-corrupt' ? 'config-corrupt' : 'ready')
      })
      .catch(() => {
        if (!cancelled) setPhase('config-corrupt')
      })
    return () => {
      cancelled = true
    }
  }, [ready])

  // No unmount guard: the recovery screen is boot-blocking, so there is no
  // navigate-away path while resetAppSettings is in flight.
  const resetSettings = useCallback(async () => {
    const r = await resetAppSettings({ db })
    setPhase(r.status === 'config-corrupt' ? 'config-corrupt' : 'ready')
  }, [])

  return { phase, resetSettings }
}
