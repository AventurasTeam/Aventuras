import { useEffect, useRef } from 'react'

export type HeldUntilDismissed = {
  /** Holds `run` for the Sheet's dismissal, replacing any run already held. */
  hold: (run: () => void) => void
  /** Drops the held run, as when the Sheet reopens over it. */
  clear: () => void
  /** Runs the held run once; the Sheet's `onDismissed`. */
  runHeld: () => void
}

/**
 * Holds a run until a phone Sheet's exit ends. The Sheet fires `onDismissed` only while mounted, so
 * a caller that swaps the Sheet for a Popover arm on a tier change calls this above the swap: the
 * held run also goes when `sheetArm` turns false, and is dropped if the caller unmounts.
 */
export function useHeldUntilDismissed(sheetArm: boolean): HeldUntilDismissed {
  const held = useRef<(() => void) | null>(null)
  const runHeld = () => {
    const run = held.current
    held.current = null
    run?.()
  }
  useEffect(() => {
    if (!sheetArm) runHeld()
  }, [sheetArm])
  return {
    hold: (run) => {
      held.current = run
    },
    clear: () => {
      held.current = null
    },
    runHeld,
  }
}
