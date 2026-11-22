import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useHeldUntilDismissed } from '@/hooks/use-held-until-dismissed'
import { useTier } from '@/hooks/use-tier'
import type { StoreChapter } from '@/lib/stores'

/**
 * The review window's mount, apart from its request: the last window stays mounted, closed, until
 * its exit ends (phone Sheet slide-out). A request returning mid-exit is held until it ends, as a
 * Sheet presented while dismissing never appears. A phone window closed unpresented unmounts now.
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
  const isPhone = useTier() === 'phone'
  const afterExit = useHeldUntilDismissed(isPhone)
  const [shown, setShown] = useState<StoreChapter | null>(null)
  // The window whose exit is running, until `onExited`.
  const [exitingId, setExitingId] = useState<string | null>(null)
  // The phone window whose Sheet has presented: only its dismissal reports an exit.
  const [presentedId, setPresentedId] = useState<string | null>(null)
  if (requested != null && requested !== shown) {
    setShown(requested)
    // Another chapter's window mounts fresh; the old one's exit never reports.
    if (shown?.id !== requested.id) {
      setExitingId(null)
      setPresentedId(null)
    }
  }
  if (requested == null && shown != null) {
    if (!isPhone || presentedId === shown.id) {
      if (exitingId !== shown.id) setExitingId(shown.id)
    } else {
      setShown(null)
    }
  }

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
    setPresentedId(null)
    if (requestedNow()) {
      held.runHeld()
      return
    }
    setShown(null)
    setExitingId(null)
  }, [])
  const onPresented = useCallback((id: string) => setPresentedId(id), [])
  const open = requested != null && requested.id !== exitingId
  // Guards a direct `onOpenChange(false)` on a window that is already closed, so it can't drop a
  // reopen held behind it.
  const onOpenChange = (next: boolean) => {
    if (!next && open) onClose()
  }
  return { shown, open, onOpenChange, onExited, onPresented }
}
