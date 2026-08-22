import { useEffect } from 'react'

import { openSheetsStore } from '@/lib/stores'

/**
 * Reports a phone bottom sheet as open for as long as `open` holds, so surfaces
 * that must not stack on one (the Actions menu, itself a sheet on phone) can see
 * it without the sheet's owner threading a prop up to the route.
 *
 * Keyed on `open`, not on mount: the sheet primitives stay mounted while closed
 * and drive presentation from this flag, so a mount-scoped effect would report
 * every sheet on screen as open.
 */
export function useRegisteredSheet(open: boolean): void {
  useEffect(() => {
    if (!open) return undefined
    // Minted inside the effect so acquire and release always name the same token.
    const token = {}
    openSheetsStore.acquire(token)
    return () => openSheetsStore.release(token)
  }, [open])
}
