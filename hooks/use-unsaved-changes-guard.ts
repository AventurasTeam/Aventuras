import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

import type { NativeApi } from '@/types/native'

type CloseBridge = Pick<NativeApi, 'setCloseGuard' | 'confirmClose' | 'onCloseRequested'>

// The declared type says nothing about what the running preload exposes: the
// web build has no `window.native` at all, and an older desktop shell can be
// missing methods this build expects. Probe before trusting it.
function closeBridge(): CloseBridge | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null
  const native = window.native
  if (
    typeof native?.setCloseGuard !== 'function' ||
    typeof native.confirmClose !== 'function' ||
    typeof native.onCloseRequested !== 'function'
  ) {
    return null
  }
  return native
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
