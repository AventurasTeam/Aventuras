import { useEffect, useRef } from 'react'

import { generationStore } from '@/lib/stores'

/**
 * Re-reads what an open confirm shows whenever a run settles past the count it was read at
 * (rollback-confirm.md → Counts). The host keeps its own skip, refusal handling and logs.
 */
export function useSettleReread({
  targetKey,
  countedAtSettle,
  onSettle,
}: {
  /** What the host shows, by identity; null while it shows nothing. A change drops a read in flight. */
  targetKey: string | null
  /** The settle count the shown data was read at; only a settle past it re-reads. */
  countedAtSettle: number | null
  /**
   * Called once per settle past `countedAtSettle`. `isLive()` turns false once a newer settle,
   * another target or the host closing supersedes the read.
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

  useEffect(() => {
    if (targetKey == null || countedAtSettle == null || settleCount <= countedAtSettle)
      return undefined
    let live = true
    latest.current(() => live)
    return () => {
      live = false
    }
  }, [targetKey, countedAtSettle, settleCount])
}
