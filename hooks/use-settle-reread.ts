import { useEffect, useRef } from 'react'

import { generationStore } from '@/lib/stores'

/**
 * Re-reads what an open confirm shows whenever a run settles past the count it was read at
 * (rollback-confirm.md → Counts). The host keeps its own skip, refusal handling and logs.
 */
export function useSettleReread({
  target,
  onSettle,
}: {
  /**
   * What the host shows, by identity, and the settle count it was read at; null while it shows
   * nothing. A new key drops a read in flight.
   */
  target: { key: string; countedAtSettle: number } | null
  /**
   * Called once per render in which the settle count has moved past `countedAtSettle`. `isLive()`
   * turns false once a newer settle, another target or the host closing supersedes the read.
   */
  onSettle: (isLive: () => boolean) => void
}): void {
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  // The re-read effect's cleanup is what drops a stale read, so the host's fresh callback each
  // render must not re-run it: it rides in a ref.
  const latest = useRef(onSettle)
  useEffect(() => {
    latest.current = onSettle
  })

  // Primitives, so a host's fresh target object each render re-runs nothing.
  const key = target?.key ?? null
  const countedAtSettle = target?.countedAtSettle ?? null
  useEffect(() => {
    if (key == null || countedAtSettle == null || settleCount <= countedAtSettle) return undefined
    let live = true
    latest.current(() => live)
    return () => {
      live = false
    }
  }, [key, countedAtSettle, settleCount])
}
