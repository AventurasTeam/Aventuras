/** Below this the visual viewport has shrunk for something other than a keyboard. */
const KEYBOARD_MIN_PX = 80

/**
 * iOS. WKWebView leaves the layout viewport at full height when the keyboard opens and scrolls the
 * document to the focused field instead, overflow: hidden or not, which drags the header and any
 * sheet's top off screen. This pins the scroll at 0 and publishes the keyboard's height as
 * `--keyboard-inset`, which `--app-height` and the sheets subtract. See overview.md, "The soft keyboard".
 */
export function trackIosKeyboard(): () => void {
  const vv = window.visualViewport
  if (!vv) return () => {}
  const root = document.documentElement
  let insetPx = 0

  // With the document pinned, only the field's own scroller can bring it above the keyboard.
  function revealFocused() {
    requestAnimationFrame(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement && el.matches('input, textarea, [contenteditable]')) {
        el.scrollIntoView({ block: 'nearest' })
      }
    })
  }

  function update() {
    if (!vv) return
    // The visible height in layout pixels: a pinch zoom shrinks vv.height by the scale, the keyboard does not.
    const inset = Math.max(0, Math.round(root.clientHeight - vv.height * vv.scale))
    const next = inset >= KEYBOARD_MIN_PX ? inset : 0
    if (next !== insetPx) {
      insetPx = next
      root.style.setProperty('--keyboard-inset', `${next}px`)
      root.toggleAttribute('data-keyboard-open', next > 0)
      if (next > 0) revealFocused()
    }
    // A zoomed page pans by design; only snap back at the scale the keyboard scroll happens at.
    const zoomed = vv.scale > 1.01
    if (!zoomed && (window.scrollY !== 0 || vv.offsetTop !== 0)) window.scrollTo(0, 0)
  }

  function onFocusIn() {
    if (insetPx > 0) revealFocused()
  }

  update()
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  document.addEventListener('focusin', onFocusIn)
  return () => {
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
    document.removeEventListener('focusin', onFocusIn)
    root.style.removeProperty('--keyboard-inset')
    root.removeAttribute('data-keyboard-open')
  }
}
