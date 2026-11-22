import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { useTier } from '@/hooks/use-tier'
import type { StoreChapter } from '@/lib/stores'

/** The mounted window, open or still exiting. */
type Presence = {
  chapter: StoreChapter
  /** Phone: its Sheet has presented, so only then does its dismissal report an exit. */
  presented: boolean
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
      : { chapter: requested, presented: false }
  }
  if (prev == null || (isPhone && !prev.presented)) return null
  return prev
}

/**
 * The review window's mount, apart from its request: the last window stays mounted, closed, until
 * its exit ends (phone Sheet slide-out). A phone window closed unpresented unmounts at once.
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
  const [stored, setStored] = useState<Presence | null>(null)
  const presence = nextPresence(stored, requested, isPhone)
  if (presence !== stored) setStored(presence)

  const latest = useRef({ isRequestedNow })
  useLayoutEffect(() => {
    latest.current = { isRequestedNow }
  })

  // A window reopened during its exit stays: the Sheet presents it again once the exit ends.
  const onExited = useCallback(() => {
    const stays = latest.current.isRequestedNow()
    setStored((p) => (p != null && stays ? { ...p, presented: false } : null))
  }, [])
  const onPresented = useCallback(
    (id: string) =>
      setStored((p) => (p?.chapter.id === id && !p.presented ? { ...p, presented: true } : p)),
    [],
  )
  const open = requested != null
  // A close reported by the render that closed the window can't close a request made since.
  const onOpenChange = (next: boolean) => {
    if (!next && open) onClose()
  }
  return { shown: presence?.chapter ?? null, open, onOpenChange, onExited, onPresented }
}
