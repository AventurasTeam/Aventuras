import { useEffect, useRef, useState } from 'react'

/**
 * An overlay's open state that reports changes only: a Popover's `TriggerRef.close()` calls
 * `onOpenChange` on a closed popover too.
 */
export function useReportedOpen(onOpenChange: ((open: boolean) => void) | undefined) {
  const [open, setOpen] = useState(false)
  const change = (next: boolean) => {
    if (next === open) return
    setOpen(next)
    onOpenChange?.(next)
  }
  // A tier flip swaps the arms, and the open one unmounts without closing.
  const committed = useRef({ open, onOpenChange })
  useEffect(() => {
    committed.current = { open, onOpenChange }
  })
  useEffect(
    () => () => {
      if (committed.current.open) committed.current.onOpenChange?.(false)
    },
    [],
  )
  return [open, change] as const
}
