import { useEffect } from 'react'

// Surfaces whose pending step must not be navigated out from under it.
const inertHolders = new Set<object>()

/** Whether a surface holds the mouse's Back inert (`useMouseHistoryButtons` reads it). */
export function isMouseBackInert(): boolean {
  return inertHolders.size > 0
}

/** While `active`, the mouse's Back does nothing. */
export function useInertMouseBack(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined
    // Minted inside the effect, so each surface holds its own.
    const holder = {}
    inertHolders.add(holder)
    return () => {
      inertHolders.delete(holder)
    }
  }, [active])
}
