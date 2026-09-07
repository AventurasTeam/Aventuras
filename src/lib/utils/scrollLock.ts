/**
 * Teardown a closing modal can leave behind: a body scroll lock, and a focused field.
 *
 * Both modal libraries lock `document.body` while something is open and clean up on the
 * path they expect. The path they do not expect is the component being unmounted while
 * still open, which is how several modals here close — `SetupWizard.handleClose()` flips
 * `isOpen` and then calls `onClose()`, which removes the whole thing from the tree.
 *
 * `vaul-svelte` restores from the setter of its `open` box, so a close driven from the
 * other side never reaches it and `body` keeps `pointer-events: none` for the rest of the
 * session — an app that renders perfectly and ignores every tap.
 *
 * Nothing here is a substitute for closing a modal properly. It is the net under it.
 */

import { MODAL_CLOSE_TRANSITION_MS } from '$lib/constants/layout'

/** Marks menu content that has opted out of the body lock, so it is never mistaken for an owner. */
export const NO_SCROLL_LOCK_ATTR = 'data-no-scroll-lock'

/**
 * Everything in this stack that legitimately holds a body lock, as it appears in the DOM.
 *
 * `bits-ui` resolves `preventScroll ?? true`, so dialog, alert-dialog, context-menu and
 * dropdown/menu lock; a sub-menu does not, but looks identical, hence the marker.
 * `[data-state]` separates these from a hand-rolled overlay with the same role, which holds
 * no lock and must not veto recovery.
 */
const OVERLAY_CLAUSES = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  `[role="menu"]:not([${NO_SCROLL_LOCK_ATTR}])`,
  '[data-vaul-drawer]',
]

const OPEN_OVERLAY_SELECTOR = OVERLAY_CLAUSES.map((c) => `${c}[data-state="open"]`).join(', ')
const CLOSING_OVERLAY_SELECTOR = OVERLAY_CLAUSES.map((c) => `${c}[data-state="closed"]`).join(', ')

const closingSince = new WeakMap<Element, number>()

/** Is a closing overlay still within the window where it may hold its lock? */
export function isWithinCloseGrace(since: number, now: number): boolean {
  return now - since < MODAL_CLOSE_TRANSITION_MS
}

/**
 * Is any of these entitled to hold the body lock?
 *
 * A closing overlay still owns its lock, since the owner unmounts with the element rather than
 * with the state flip — but only until its exit could have finished, or a node stalled at
 * `closed` would veto recovery for the rest of the session. Reopening clears the clock: the
 * same element can close, reopen and close again, and the second close starts over.
 */
export function hasEntitledOwner<T extends object>(
  open: readonly T[],
  closing: readonly T[],
  since: WeakMap<T, number>,
  now: number,
): boolean {
  for (const el of open) since.delete(el)
  if (open.length > 0) return true

  for (const el of closing) {
    const seen = since.get(el)
    if (seen === undefined) {
      since.set(el, now)
      return true
    }
    if (isWithinCloseGrace(seen, now)) return true
  }
  return false
}

/** Is anything on screen entitled to be holding the body lock right now? */
function hasOpenOverlay(): boolean {
  return hasEntitledOwner(
    Array.from(document.querySelectorAll(OPEN_OVERLAY_SELECTOR)),
    Array.from(document.querySelectorAll(CLOSING_OVERLAY_SELECTOR)),
    closingSince,
    Date.now(),
  )
}

/**
 * Is the body locked? Pure so the decision can be tested without a DOM.
 *
 * Either property alone counts: `bits-ui` applies `overflow` synchronously and
 * `pointer-events` an `afterTick` later, so both half-states are reachable.
 */
export function isBodyLocked(pointerEvents: string, overflow: string): boolean {
  return pointerEvents === 'none' || overflow === 'hidden'
}

/** Is `document.body` locked right now? */
export function isBodyLockPresent(): boolean {
  if (typeof document === 'undefined') return false
  const { pointerEvents, overflow } = document.body.style
  return isBodyLocked(pointerEvents, overflow)
}

/**
 * Drop the body lock, but only if nothing present should be holding it.
 *
 * Returns whether it released anything, which is what makes it safe to call from a modal's
 * own teardown: a modal closing on top of another finds the one underneath and leaves the
 * lock alone.
 *
 * `document.body` only — neither library writes the equivalent on `documentElement`, and
 * `data-scroll-locked` is a Radix attribute this app never sets.
 */
export function releaseOrphanScrollLock(): boolean {
  if (typeof document === 'undefined') return false
  if (!isBodyLockPresent()) return false
  if (hasOpenOverlay()) return false

  document.body.style.pointerEvents = ''
  document.body.style.overflow = ''
  return true
}

/**
 * Drop focus, so the Android soft keyboard goes down with the modal that raised it.
 *
 * Mobile only: on desktop both libraries return focus to whatever opened the modal, and
 * blurring first sends it to `<body>` instead — Tab restarts from the top of the document
 * and a screen reader loses its place. There is no keyboard there to buy that back.
 */
export function blurFocusedElement(isMobile: boolean): void {
  if (!isMobile || typeof document === 'undefined') return
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}
