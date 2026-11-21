import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useHeldUntilDismissed } from '@/hooks/use-held-until-dismissed'
import { useTier } from '@/hooks/use-tier'
import type { StoreChapter } from '@/lib/stores'

/**
 * The review window's mount, apart from its request: the last window held open stays mounted,
 * closed, until its exit ends, so the phone Sheet can slide out. A request that returns during the
 * exit is held until it ends: a Sheet presented while still dismissing never appears.
 */
export function useReviewWindowPresence({
  requested,
  isRequestedNow,
  onClose,
}: {
  /** The chapter whose window the request names, or null while none is open. */
  requested: StoreChapter | null
  /** Read at the exit's end: a window reopened during its exit stays. */
  isRequestedNow: () => boolean
  onClose: () => void
}) {
  const afterExit = useHeldUntilDismissed(useTier() === 'phone')
  const [shown, setShown] = useState<StoreChapter | null>(null)
  // The window whose exit is running, until `onExited`.
  const [exitingId, setExitingId] = useState<string | null>(null)
  if (requested != null && requested !== shown) {
    setShown(requested)
    // Another chapter's window mounts fresh; the old one's exit never reports.
    if (shown?.id !== requested.id) setExitingId(null)
  }
  if (requested == null && shown != null && exitingId !== shown.id) setExitingId(shown.id)

  const reopenHeld = requested != null && requested.id === exitingId
  const latest = useRef({ afterExit, isRequestedNow })
  useLayoutEffect(() => {
    latest.current = { afterExit, isRequestedNow }
  })
  useEffect(() => {
    if (!reopenHeld) return
    latest.current.afterExit.hold(() => setExitingId(null))
    return () => latest.current.afterExit.clear()
  }, [reopenHeld])

  const onExited = useCallback(() => {
    const { afterExit: held, isRequestedNow: requestedNow } = latest.current
    if (requestedNow()) {
      held.runHeld()
      return
    }
    setShown(null)
    setExitingId(null)
  }, [])
  // A close while already closed (a Sheet's late dismiss) must not drop a reopen held behind it.
  const open = requested != null && requested.id !== exitingId
  const onOpenChange = (next: boolean) => {
    if (!next && open) onClose()
  }
  return { shown, open, onOpenChange, onExited }
}
