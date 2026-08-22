import { useEffect } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/**
 * The overlays currently claiming the surface — bottom sheets and modal
 * dialogs — held as opaque per-instance tokens.
 *
 * A set rather than a counter: a duplicate release is a no-op instead of
 * underflowing the gate into permanently-unblocked, which fails open silently.
 */
type BlockingOverlaysState = { open: ReadonlySet<object> }

const store = createStore<BlockingOverlaysState>()(() => ({ open: new Set<object>() }))

// Deliberately absent from the stores barrel, which is the module boundary
// `boundaries/dependencies` enforces: outside this module the only way to hold a
// registration is useRegisteredOverlay, which mints its token inside the effect.
// A caller that could acquire directly could acquire a token it never releases —
// a count that only grows, leaving the Actions menu inert for the session.
export function acquire(token: object): void {
  store.setState((s) => {
    if (s.open.has(token)) return s
    const open = new Set(s.open)
    open.add(token)
    return { open }
  })
}

export function release(token: object): void {
  store.setState((s) => {
    if (!s.open.has(token)) return s
    const open = new Set(s.open)
    open.delete(token)
    return { open }
  })
}

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
    acquire(token)
    return () => release(token)
  }, [open])
}

export const blockingOverlaysStore = {
  useBlockingOverlayCount: (): number => useStore(store, (s) => s.open.size),
  getState: (): BlockingOverlaysState => store.getState(),
  __reset: (): void => store.setState({ open: new Set<object>() }),
}

export type { BlockingOverlaysState }
