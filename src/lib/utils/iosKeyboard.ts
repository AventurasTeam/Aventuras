/** Rounding slack; the shortcut bar a hardware keyboard leaves (~45-55px) must still count. */
const KEYBOARD_MIN_PX = 30

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])"

/** Publishes the iOS keyboard height as `--keyboard-inset`; see overview.md, "The soft keyboard". */
export function trackIosKeyboard(): () => void {
  const vv = window.visualViewport
  if (!vv) return () => {}
  const root = document.documentElement
  let insetPx = 0

  // With the document pinned, only the field's own scroller can bring it above the keyboard.
  function revealFocused() {
    requestAnimationFrame(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement && el.matches(EDITABLE)) {
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
