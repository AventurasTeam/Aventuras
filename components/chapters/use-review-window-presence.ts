import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useHeldUntilDismissed } from '@/hooks/use-held-until-dismissed'
import { useTier } from '@/hooks/use-tier'
import type { StoreChapter } from '@/lib/stores'

/** The mounted window, open or still exiting. */
type Presence = {
  chapter: StoreChapter
  /** Phone: its Sheet has presented, so only then does its dismissal report an exit. */
  presented: boolean
  /** Its exit is running, until `onExited`. */
  exiting: boolean
}

function nextPresence(
  prev: Presence | null,
  requested: StoreChapter | null,
  isPhone: boolean,
): Presence | null {
  if (requested != null) {
    if (requested === prev?.chapter) return prev
    // Another chapter's window mounts fresh; the old one's exit never reports.
    return prev?.chapter.id === requested.id
      ? { ...prev, chapter: requested }
      : { chapter: requested, presented: false, exiting: false }
  }
  if (prev == null || (isPhone && !prev.presented)) return null
  return prev.exiting ? prev : { ...prev, exiting: true }
}

/**
 * The review window's mount, apart from its request: the last window stays mounted, closed, until
 * its exit ends (phone Sheet slide-out). A request returning mid-exit is held until it ends, as a
 * Sheet presented while dismissing never appears. A phone window closed unpresented unmounts at
 * once.
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
  const [stored, setStored] = useState<Presence | null>(null)
  const presence = nextPresence(stored, requested, isPhone)
  if (presence !== stored) setStored(presence)

  const reopenHeld = requested != null && presence?.exiting === true
  const latest = useRef({ afterExit, isRequestedNow })
  useLayoutEffect(() => {
    latest.current = { afterExit, isRequestedNow }
  })
  useEffect(() => {
    if (!reopenHeld) return
    latest.current.afterExit.hold(() =>
      setStored((p) => (p?.exiting === true ? { ...p, exiting: false } : p)),
    )
    return () => latest.current.afterExit.clear()
  }, [reopenHeld])

  // Ends the exit itself, not through the held run: a reopen requested before its hold registered
  // would otherwise wait for a dismissal that already fired.
  const onExited = useCallback(() => {
    const stays = latest.current.isRequestedNow()
    setStored((p) => (p != null && stays ? { ...p, presented: false, exiting: false } : null))
  }, [])
  const onPresented = useCallback(
    (id: string) =>
      setStored((p) => (p?.chapter.id === id && !p.presented ? { ...p, presented: true } : p)),
    [],
  )
  const open = requested != null && !reopenHeld
  // Guards a direct `onOpenChange(false)` on a window that is already closed, so it can't drop a
  // reopen held behind it.
  const onOpenChange = (next: boolean) => {
    if (!next && open) onClose()
  }
  return { shown: presence?.chapter ?? null, open, onOpenChange, onExited, onPresented }
}
