import { useNavigation, usePreventRemove } from '@react-navigation/native'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'

import type { NativeApi } from '@/types/native'

type CloseBridge = Pick<
  NativeApi,
  'setCloseGuard' | 'confirmClose' | 'onCloseRequested' | 'confirmReload' | 'onReloadRequested'
>

// The declared type says nothing about what the running preload exposes: the
// web build has no `window.native` at all. Probe before trusting it.
//
// All-or-nothing on purpose, and only safe because preload and renderer ship in
// one bundle. A preload with the close methods but not the reload ones falls to
// the browser path, where the guard still prevents its own unload but nothing
// arms `closeGuards` and nothing answers a reload ask — leaving the window
// unclosable while dirty, with no dialog. That is a stale local
// `electron:compile`, not a shippable state, and failing loudly beats a silent
// half-guard.
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
    if (native != null && !dirty) {
      // Still syncs: a reload leaves the main process holding a guard armed
      // by the previous renderer, with no listener behind it.
      syncBridge(native)
      return undefined
    }
    if (!dirty) return undefined

    // Per-surface function, not a shared one: `addEventListener` dedupes the
    // same reference, so one surface going clean would unhook every other.
    // A browser turns this into its own prompt; Electron turns it into
    // `will-prevent-unload`, which main answers by asking through the bridge.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    if (native == null) {
      return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }

    const entry = requestLeaveRef
    armed.add(entry)
    syncBridge(native)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      armed.delete(entry)
      syncBridge(native)
    }
  }, [dirty])
}
