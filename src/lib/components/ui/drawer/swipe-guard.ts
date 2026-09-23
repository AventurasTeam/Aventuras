/** Passed to every drawer as `closeThreshold`; the guard below has to agree with it. */
export const DRAWER_CLOSE_THRESHOLD = 0.75

// `vaul-svelte` internals (`internal/constants.js`), not exported: its flick speed in px/ms and
// its settle transition. Recheck both on upgrade, along with the seam this guard relies on; see
// docs/architecture/overview.md, "Drawer swipes".
const VELOCITY_THRESHOLD = 0.4
const SETTLE_TRANSITION = 'transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)'
const OVERLAY_TRANSITION = 'opacity 0.5s cubic-bezier(0.32, 0.72, 0, 1)'

function translateY(node: HTMLElement): number {
  const transform = getComputedStyle(node).transform
  if (!transform || transform === 'none') return 0
  return new DOMMatrixReadOnly(transform).m42
}

/**
 * Stops a swipe from closing a drawer, and reports it instead, while `shouldBlock` holds.
 *
 * `vaul` gives no way to veto a close, but its content's pointer-up handler calls the caller's
 * `onpointerup` just before measuring the swipe. `release` goes there (and on `onpointerout`,
 * which `vaul` also treats as a release): when the release would close, it puts the sheet back
 * at rest so `vaul` finds nothing to act on, then animates the settle itself.
 */
export function createDrawerSwipeGuard(shouldBlock: () => boolean, onBlocked: () => void) {
  let start: { y: number; t: number } | null = null

  // The drawer content never sees a handle-only drag's pointerdown, so it is watched from above.
  function onPointerDown(e: PointerEvent) {
    start = { y: e.pageY, t: Date.now() }
  }

  function release(e: PointerEvent) {
    const from = start
    start = null
    const node = e.currentTarget
    if (!from || !(node instanceof HTMLElement) || !shouldBlock()) return

    const swipe = translateY(node)
    const moved = e.pageY - from.y
    if (swipe <= 0 || moved <= 0) return

    const velocity = moved / Math.max(1, Date.now() - from.t)
    const visible = Math.min(node.getBoundingClientRect().height, window.innerHeight)
    if (velocity <= VELOCITY_THRESHOLD && swipe < visible * DRAWER_CLOSE_THRESHOLD) return

    // Committed while `vaul`'s dragging class still suppresses the transition, so the computed
    // position it reads next is already 0 rather than the start of an animation back.
    node.style.transform = 'translate3d(0, 0, 0)'
    void getComputedStyle(node).transform

    // Runs once `vaul`'s handler has returned, before the next paint.
    queueMicrotask(() => {
      node.style.transition = 'none'
      node.style.transform = `translate3d(0, ${swipe}px, 0)`
      void node.offsetHeight
      node.style.transition = SETTLE_TRANSITION
      node.style.transform = 'translate3d(0, 0, 0)'

      const overlays = document.querySelectorAll<HTMLElement>('[data-vaul-overlay]')
      const overlay = overlays[overlays.length - 1]
      if (overlay) {
        overlay.style.transition = OVERLAY_TRANSITION
        overlay.style.opacity = '1'
      }
    })

    onBlocked()
  }

  window.addEventListener('pointerdown', onPointerDown, true)

  return {
    release,
    destroy: () => window.removeEventListener('pointerdown', onPointerDown, true),
  }
}
