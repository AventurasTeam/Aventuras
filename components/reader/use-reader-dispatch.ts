import { useCallback, useEffect, useRef, useState } from 'react'

import { readerHoldStore } from '@/lib/stores'

export type ReaderDispatch = {
  /** Marks a dispatch; false, marking nothing, while one is in flight or the reader is held. */
  begin: () => boolean
  end: () => void
  /** A dispatch in flight or the reader held, read live. */
  isBlocked: () => boolean
  /** The reader hold, read live from the store. */
  isHeld: () => boolean
  inFlight: boolean
  held: boolean
}

/**
 * The reader's dispatch mark and its branch's reader hold as one blocked read, so no handler can
 * check the mark and forget the hold (branch-navigator.md → Per-row anatomy).
 */
export function useReaderDispatch(branchId: string): ReaderDispatch {
  // `editBlocked` rises a queue hop and several awaits after the tap; only Send survives the gap
  // (the composer clears), so each dispatch marks it: ref is the sync guard, state disables.
  const inFlightRef = useRef(false)
  const [inFlight, setInFlight] = useState(false)
  const held = readerHoldStore.useHeld(branchId)
  // A hold whose switch never reached its navigation ends with the reader.
  useEffect(() => () => readerHoldStore.clear(branchId), [branchId])
  const isHeld = useCallback(() => readerHoldStore.isHeld(branchId), [branchId])
  const isBlocked = useCallback(() => inFlightRef.current || isHeld(), [isHeld])
  const begin = useCallback((): boolean => {
    if (isBlocked()) return false
    inFlightRef.current = true
    setInFlight(true)
    return true
  }, [isBlocked])
  const end = useCallback(() => {
    inFlightRef.current = false
    setInFlight(false)
  }, [])
  return { begin, end, isBlocked, isHeld, inFlight, held }
}
