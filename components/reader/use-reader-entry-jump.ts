import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import type { DbCtx } from '@/lib/db'

import { useEntryJump, type EntryJump } from './use-entry-jump'

type Landing = { readonly entryId: string; readonly sent: boolean }

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
  const landingRef = useRef<Landing | null>(null)
  useLayoutEffect(() => {
    readyRef.current = ready
  }, [ready])

  const land = useCallback(
    (entryId: string) => {
      const sent = readyRef.current
      landingRef.current = { entryId, sent }
      if (sent) send(entryId)
    },
    [send],
  )
  const { jump: jumpEntry, veil, landed } = useEntryJump(branchId, ctx, land, topLoaded)
  // A newer jump replaces the landing held or sent before it, even while the veil stays up: a stale
  // sent id lost to a reload could otherwise match the newer target and lift its veil mid-read.
  const jump = useCallback(
    (entryId: string) => {
      landingRef.current = null
      return jumpEntry(entryId)
    },
    [jumpEntry],
  )

  // Whatever ends the wait ends the landing it covered, shown or not.
  useEffect(
    () =>
      veil.subscribe(() => {
        if (!veil.isWaiting()) landingRef.current = null
      }),
    [veil],
  )
  useEffect(() => {
    landingRef.current = null
  }, [branchId])

  useEffect(() => {
    const landing = landingRef.current
    if (landing === null) return
    if (!ready) {
      if (!landing.sent) return
      landingRef.current = null
      landed(landing.entryId)
      return
    }
    if (landing.sent) return
    landingRef.current = { entryId: landing.entryId, sent: true }
    send(landing.entryId)
  }, [landed, ready, send])

  return { jump, veil, landed }
}
