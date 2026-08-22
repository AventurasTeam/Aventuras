import { useEffect } from 'react'

import { blockingOverlaysStore } from '@/lib/stores'

/**
 * Reports a bottom sheet or modal dialog as claiming the surface for as long as
 * `open` holds, so surfaces that must not stack on one (the Actions menu) can
 * see it without the overlay's owner threading a prop up to the route.
 *
 * Keyed on `open`, not on mount: the sheet primitives stay mounted while closed
 * and drive presentation from this flag, so a mount-scoped effect would report
 * every sheet on screen as open.
 */
export function useRegisteredOverlay(open: boolean): void {
  useEffect(() => {
    if (!open) return undefined
    // Minted inside the effect so acquire and release always name the same token.
    const token = {}
    blockingOverlaysStore.acquire(token)
    return () => blockingOverlaysStore.release(token)
  }, [open])
}
