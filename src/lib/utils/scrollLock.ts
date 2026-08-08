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

/**
 * Everything in this stack that legitimately holds a body lock, as it appears in the DOM.
 *
 * Only `preventScroll` defaults to true in `bits-ui` — dialog, alert-dialog and
 * context-menu; select, popover and dropdown-menu never lock. A missing selector here
 * would unlock the page under an open modal.
 */
const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[data-vaul-drawer][data-state="open"]',
].join(', ')

/** Is anything on screen entitled to be holding the body lock right now? */
function hasOpenOverlay(): boolean {
  return document.querySelector(OPEN_OVERLAY_SELECTOR) !== null
}

/**
 * Drop the body lock, but only if nothing open should be holding it.
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
