import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import type { DbCtx } from '@/lib/db'

import { useEntryJump, type EntryJump } from './use-entry-jump'

/**
 * `useEntryJump` bound to the reader's mount. `send` reaches the surface or the document; `ready`
 * says a call would arrive (native: the document has painted since it last booted). A landing made
 * while not ready waits for ready; a reload loses a landing already sent, so its veil lifts.
 */
export function useReaderEntryJump(
  branchId: string,
  ctx: DbCtx,
  ready: boolean,
  send: (entryId: string) => void,
  topLoaded: () => void,
): EntryJump {
  const readyRef = useRef(ready)
  const heldRef = useRef<string | null>(null)
  const sentRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    readyRef.current = ready
  }, [ready])

  const land = useCallback(
    (entryId: string) => {
      if (!readyRef.current) {
        heldRef.current = entryId
        return
      }
      sentRef.current = entryId
      send(entryId)
    },
    [send],
  )
  const { jump: jumpEntry, veil, landed } = useEntryJump(branchId, ctx, land, topLoaded)
  // A newer jump replaces the landing held or sent before it, even while the veil stays up: a stale
  // sent id lost to a reload could otherwise match the newer target and lift its veil mid-read.
  const jump = useCallback(
    (entryId: string) => {
      heldRef.current = null
      sentRef.current = null
      return jumpEntry(entryId)
    },
    [jumpEntry],
  )

  // Whatever ends the wait ends the landing it covered, shown or not.
  useEffect(
    () =>
      veil.subscribe(() => {
        if (veil.isWaiting()) return
        heldRef.current = null
        sentRef.current = null
      }),
    [veil],
  )
  useEffect(() => {
    heldRef.current = null
    sentRef.current = null
  }, [branchId])

  useEffect(() => {
    if (!ready) {
      const lost = sentRef.current
      sentRef.current = null
      if (lost != null) landed(lost)
      return
    }
    const held = heldRef.current
    if (held == null) return
    heldRef.current = null
    sentRef.current = held
    send(held)
  }, [landed, ready, send])

  return { jump, veil, landed }
}
