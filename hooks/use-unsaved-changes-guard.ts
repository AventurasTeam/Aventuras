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

type LeaveRequest = (proceed: () => void) => void

// `setCloseGuard` is one boolean per window, so it can't be a per-surface
// claim: expo-router keeps a pushed-under screen mounted, and a second surface
// mounting clean would otherwise disarm a first that is still dirty. This set
// is the source of truth and the bridge only mirrors whether it is empty.
const armed = new Set<{ current: LeaveRequest }>()
let unsubscribe: (() => void) | null = null

function askEach(native: CloseBridge): void {
  // Snapshot: a surface goes clean and drops out of `armed` as it answers, so
  // iterating the live set would skip whoever follows it.
  const queue = [...armed]
  const step = (index: number): void => {
    if (index >= queue.length) {
      native.confirmClose()
      return
    }
    // Cancel is the absence of a call: a surface that never runs `proceed`
    // stops the chain here, leaving the close prevented and the guard armed.
    queue[index].current(() => step(index + 1))
  }
  step(0)
}

function syncBridge(native: CloseBridge): void {
  if (armed.size > 0) {
    native.setCloseGuard(true)
    unsubscribe ??= native.onCloseRequested(() => askEach(native))
    return
  }
  native.setCloseGuard(false)
  unsubscribe?.()
  unsubscribe = null
}

/**
 * Extends a surface's unsaved-changes guard to the window itself.
 *
 * On Electron the main process holds the close until every dirty surface has
 * run the callback it is handed, so the user answers each surface's own Save /
 * Discard / Cancel dialog in turn. In a browser `beforeunload` cannot be
 * resumed once it returns, so the guard can only raise the browser's native
 * prompt — `requestLeave` never runs there.
 *
 * @param dirty - Whether the surface currently holds unsaved work.
 * @param requestLeave - Runs its argument once the user confirms leaving.
 */
export function useUnsavedChangesGuard(dirty: boolean, requestLeave: LeaveRequest): void {
  const requestLeaveRef = useRef(requestLeave)
  requestLeaveRef.current = requestLeave

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined

    const native = closeBridge()
    if (native != null) {
      if (!dirty) {
        // Still syncs: a reload leaves the main process holding a guard armed
        // by the previous renderer, with no listener behind it.
        syncBridge(native)
        return undefined
      }
      const entry = requestLeaveRef
      armed.add(entry)
      syncBridge(native)
      return () => {
        armed.delete(entry)
        syncBridge(native)
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
