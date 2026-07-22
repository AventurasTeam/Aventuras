import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

type CloseBridge = {
  setCloseGuard: (active: boolean) => void
  confirmClose: () => void
  onCloseRequested: (cb: () => void) => () => void
}

function closeBridge(): CloseBridge | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null
  const native = (window as { native?: Partial<CloseBridge> }).native
  if (
    typeof native?.setCloseGuard !== 'function' ||
    typeof native.confirmClose !== 'function' ||
    typeof native.onCloseRequested !== 'function'
  ) {
    return null
  }
  return native as CloseBridge
}

/**
 * Extends a surface's unsaved-changes guard to the window itself.
 *
 * On Electron the main process holds the close until `requestLeave` resolves,
 * so the user gets the surface's own Save / Discard / Cancel dialog. In a
 * browser `beforeunload` cannot be resumed once it returns, so the guard can
 * only raise the browser's native prompt — `requestLeave` never runs there.
 *
 * @param dirty - Whether the surface currently holds unsaved work.
 * @param requestLeave - Runs its argument once the user confirms leaving.
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  requestLeave: (proceed: () => void) => void,
): void {
  const requestLeaveRef = useRef(requestLeave)
  requestLeaveRef.current = requestLeave

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined

    const native = closeBridge()
    if (native != null) {
      native.setCloseGuard(dirty)
      if (!dirty) return undefined
      const off = native.onCloseRequested(() => {
        requestLeaveRef.current(() => native.confirmClose())
      })
      return () => {
        off()
        native.setCloseGuard(false)
      }
    }

    if (!dirty) return undefined
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}
