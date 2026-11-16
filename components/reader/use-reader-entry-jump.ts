import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import type { DbCtx } from '@/lib/db'

import type { JumpClass } from './reader-slice'
import { useEntryJump, type EntryJump } from './use-entry-jump'

type Landing = { readonly entryId: string; readonly sent: boolean }

/** The reader slice's side of a jump: where the target sits, and the slice it lands on. */
export type JumpSlice = {
  classifyJump: (entryId: string) => JumpClass
  /** Moves the slice to the target when it doesn't land at once; returns the key to name. */
  placeLanding: (entryId: string) => number
  topLoaded: () => void
}

/**
 * `useEntryJump` bound to the reader's mount. `send` reaches the surface or the document with the
 * slice key the landing waits for; `ready` says a call would arrive (native: the document has
 * painted since it last booted). A landing made while not ready waits for ready; a reload loses a
 * landing already sent, so its veil lifts. `slice`'s functions must be stable.
 */
export function useReaderEntryJump(
  branchId: string,
  ctx: DbCtx,
  ready: boolean,
  send: (entryId: string, sliceKey: number) => void,
  slice: JumpSlice,
): EntryJump {
  const readyRef = useRef(ready)
  const landingRef = useRef<Landing | null>(null)
  useLayoutEffect(() => {
    readyRef.current = ready
  }, [ready])

  const { classifyJump, placeLanding, topLoaded } = slice
  // Placed as it's sent: a reload resets the slice to the tail before ready, so a key named
  // earlier would wait for a slice already gone.
  const land = useCallback(
    (entryId: string) => {
      const sent = readyRef.current
      landingRef.current = { entryId, sent }
      if (sent) send(entryId, placeLanding(entryId))
    },
    [placeLanding, send],
  )
  const {
    jump: jumpEntry,
    veil,
    landed: landedEntry,
    lost,
  } = useEntryJump(branchId, ctx, classifyJump, land, topLoaded)
  // Only a landing already sent can land: a late signal from an earlier landing of the same row
  // would otherwise lift a newer jump's veil while its read is still out.
  const landed = useCallback(
    (entryId: string) => {
      const landing = landingRef.current
      if (landing?.sent && landing.entryId === entryId) landedEntry(entryId)
    },
    [landedEntry],
  )
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
      lost(landing.entryId)
      return
    }
    if (landing.sent) return
    landingRef.current = { ...landing, sent: true }
    send(landing.entryId, placeLanding(landing.entryId))
  }, [lost, placeLanding, ready, send])

  return { jump, veil, landed }
}
