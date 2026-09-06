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

/** Marks menu content that has opted out of the body lock, so it is never mistaken for an owner. */
export const NO_SCROLL_LOCK_ATTR = 'data-no-scroll-lock'

/**
 * Everything in this stack that legitimately holds a body lock, as it appears in the DOM.
 *
 * `preventScroll` resolves to `preventScroll ?? true` in `bits-ui`, so dialog, alert-dialog,
 * context-menu AND dropdown/menu all lock; popover, select, tooltip, link-preview and
 * sub-menus pass `false`. `vaul` drawers lock through their own mechanism.
 *
 * Two rules decide what belongs here, and both matter:
 *
 * - Presence, not open state. A lock owner is mounted and unmounted with its element, so it
 *   still holds the lock while animating closed. Matching `[data-state="open"]` would release
 *   the lock under a modal opening behind one that is still exiting.
 * - `[data-state]` is what separates a library-managed owner from a hand-rolled overlay
 *   carrying the same ARIA role. Both libraries set it for the element's whole life; the
 *   app's own overlays (the expanded portrait, the wizard discard prompt) never do, and must
 *   not be able to veto recovery — a veto strands the user, since they hold no lock to release.
 */
const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state]',
  '[role="alertdialog"][data-state]',
  `[role="menu"][data-state]:not([${NO_SCROLL_LOCK_ATTR}])`,
  '[data-vaul-drawer][data-state]',
].join(', ')

/** Is anything on screen entitled to be holding the body lock right now? */
function hasOpenOverlay(): boolean {
  return document.querySelector(OPEN_OVERLAY_SELECTOR) !== null
}

/**
 * Is the body locked? Pure so the decision can be tested without a DOM.
 *
 * Either property alone is a lock: `bits-ui` applies `overflow` synchronously and
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
