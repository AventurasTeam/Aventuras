import { useLayoutEffect, useRef, type RefObject } from 'react'
import { Platform } from 'react-native'

// overlays.md → Close focus: an overlay that closes hands the element it opened from to the dialog
// its entry opens in the same breath, whose own opener has unmounted by then.
const HANDOFF_MS = 2000
let handed: { target: HTMLElement; at: number } | null = null
/** The `dataSet` key an overlay sets while it closes but stays mounted. */
export const OVERLAY_CLOSING = 'overlayClosing'

// The origins of the overlays open now, innermost last.
const openOrigins: { origin: HTMLElement | null }[] = []

function focusedElement(): HTMLElement | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

function canTakeFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return (
    element != null &&
    element.isConnected &&
    !element.matches(':disabled') &&
    element.closest('[data-overlay-closing]') == null &&
    // A screen the stack keeps mounted beneath the current one is hidden; focus never goes there.
    // CSS visibility isn't in checkVisibility's default checks, and a hidden element won't focus.
    element.checkVisibility?.({ visibilityProperty: true }) !== false
  )
}

function handOff(target: HTMLElement | null): void {
  if (target != null) handed = { target, at: Date.now() }
}

function takeHandedOff(): HTMLElement | null {
  const offer = handed
  handed = null
  return offer != null && Date.now() - offer.at < HANDOFF_MS && offer.target.isConnected
    ? offer.target
    : null
}

/**
 * Rendered first inside an overlay's content, which mounts as it opens: remembers what held focus
 * then (its layout effect runs before the overlay moves focus) and hands it off as it unmounts,
 * before any dialog opened in the same commit reads it.
 */
export function FocusOrigin(): null {
  useLayoutEffect(() => {
    const entry = { origin: focusedElement() }
    openOrigins.push(entry)
    return () => {
      openOrigins.splice(openOrigins.indexOf(entry), 1)
      handOff(entry.origin)
    }
  }, [])
  return null
}

// A dialog registers its own origin too, the element focused as it opened, which `except` skips.
function openOverlayOrigin(except: HTMLElement | null): HTMLElement | null {
  for (let i = openOrigins.length - 1; i >= 0; i--) {
    const { origin } = openOrigins[i]!
    if (origin != null && origin !== except) return origin
  }
  return null
}

type AutoFocusHandler = (event: Event) => void

/**
 * A dialog's close focus: the consumer's own `onCloseAutoFocus` first; else `returnFocusTo`; else
 * what held focus when it opened; else the origin of the overlay it opened from, closed in the same
 * breath or still exiting; else nothing.
 */
export function useDialogFocusReturn({
  returnFocusTo,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: {
  returnFocusTo?: RefObject<unknown>
  onOpenAutoFocus?: AutoFocusHandler
  onCloseAutoFocus?: AutoFocusHandler
}): { onOpenAutoFocus: AutoFocusHandler; onCloseAutoFocus: AutoFocusHandler } {
  const openedFrom = useRef<(HTMLElement | null)[]>([])
  return {
    onOpenAutoFocus: (event) => {
      // An overlay still open (a sheet mid-exit) is the one this dialog came from; a hand-off is
      // taken either way, so a stale one never reaches a later dialog.
      const handedOff = takeHandedOff()
      const focused = focusedElement()
      openedFrom.current = [focused, openOverlayOrigin(focused) ?? handedOff]
      onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event)
      const from = openedFrom.current
      openedFrom.current = []
      if (event.defaultPrevented) return
      const named = returnFocusTo?.current
      const target = [named instanceof HTMLElement ? named : null, ...from].find(canTakeFocus)
      if (target == null) return
      event.preventDefault()
      target.focus()
    },
  }
}
