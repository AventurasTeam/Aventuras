import { useNavigation, usePreventRemove } from '@react-navigation/native'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

import type { NativeApi } from '@/types/native'

type CloseBridge = Pick<
  NativeApi,
  'setCloseGuard' | 'confirmClose' | 'onCloseRequested' | 'confirmReload' | 'onReloadRequested'
>

// The declared type says nothing about what the preload actually exposes (web has no
// `window.native`) — probe first. A partial bridge falls back to the unguarded browser path
// (main's `will-prevent-unload` fail-open).
function closeBridge(): CloseBridge | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null
  const native = window.native
  if (
    typeof native?.setCloseGuard !== 'function' ||
    typeof native.confirmClose !== 'function' ||
    typeof native.onCloseRequested !== 'function' ||
    typeof native.confirmReload !== 'function' ||
    typeof native.onReloadRequested !== 'function'
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

function askEach(confirm: () => void): void {
  // Snapshot: a surface goes clean and drops out of `armed` as it answers, so
  // iterating the live set would skip whoever follows it.
  const queue = [...armed]
  const step = (index: number): void => {
    if (index >= queue.length) {
      confirm()
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
    if (unsubscribe == null) {
      const offClose = native.onCloseRequested(() => askEach(() => native.confirmClose()))
      const offReload = native.onReloadRequested(() => askEach(() => native.confirmReload()))
      unsubscribe = () => {
        offClose()
        offReload()
      }
    }
    return
  }
  native.setCloseGuard(false)
  unsubscribe?.()
  unsubscribe = null
}

/**
 * Extends a surface's unsaved-changes guard to navigator removal, the window,
 * and a reload.
 *
 * Navigator actions are replayed exactly after the surface confirms leaving,
 * preserving the original pop/reset target. On Electron the main process
 * holds a close or a reload until every dirty surface has run the callback it
 * is handed, so the user answers each surface's own Save / Discard / Cancel
 * dialog in turn. In a browser `beforeunload` cannot be resumed once it
 * returns, so the guard can only raise the browser's native prompt —
 * `requestLeave` never runs there.
 *
 * @param dirty - Whether the surface currently holds unsaved work.
 * @param requestLeave - Runs its argument once the user confirms leaving.
 */
export function useUnsavedChangesGuard(dirty: boolean, requestLeave: LeaveRequest): void {
  const navigation = useNavigation()
  const requestLeaveRef = useRef(requestLeave)
  // Post-commit, not in render: React can discard a render pass, and both
  // readers below only fire on a later user gesture.
  useEffect(() => {
    requestLeaveRef.current = requestLeave
  })

  usePreventRemove(dirty, ({ data }) => {
    requestLeaveRef.current(() => navigation.dispatch(data.action))
  })

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined

    const native = closeBridge()
    if (!dirty) {
      // Still syncs: a reload leaves the main process holding a guard armed
      // by the previous renderer, with no listener behind it.
      if (native != null) syncBridge(native)
      return undefined
    }

    // Per-surface, not shared: addEventListener dedupes by reference — sharing it would let
    // one clean surface unhook every other. Browser prompts natively; Electron routes through
    // the bridge via will-prevent-unload. A surface dirtied without a user gesture is
    // unguarded here (lessons-learned/beforeunload-needs-sticky-activation.md).
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    const entry = requestLeaveRef
    if (native != null) {
      armed.add(entry)
      syncBridge(native)
    }
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (native != null) {
        armed.delete(entry)
        syncBridge(native)
      }
    }
  }, [dirty])
}
