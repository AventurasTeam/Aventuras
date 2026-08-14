/**
 * Svelte action that keeps a textarea exactly as tall as its content.
 *
 * The upper bound is the element's own `max-height`, so a caller caps the growth with a
 * class rather than a parameter, and the textarea scrolls internally past that point.
 */

export interface AutosizeParams {
  enabled: boolean
  /** Re-measures whenever this changes, so a value set in code resizes too, not just typing. */
  value: unknown
}

export function autosize(node: HTMLTextAreaElement, params: AutosizeParams) {
  let enabled = params.enabled
  let lastWidth = 0

  function resize() {
    if (!enabled) return
    // A textarea in a closed accordion or an inactive tab measures 0; leave its height alone.
    if (!node.offsetWidth && !node.offsetHeight) return

    const style = getComputedStyle(node)
    // `scrollHeight` excludes the border, which a border-box height still has to cover.
    const border =
      style.boxSizing === 'border-box'
        ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        : 0

    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight + border}px`
  }

  // Only width matters: it rewraps the text. Height changes are this action's own doing.
  const observer = new ResizeObserver(() => {
    if (node.offsetWidth === lastWidth) return
    lastWidth = node.offsetWidth
    resize()
  })

  node.addEventListener('input', resize)
  observer.observe(node)
  resize()

  return {
    update(next: AutosizeParams) {
      const wasEnabled = enabled
      enabled = next.enabled
      if (!enabled) {
        if (wasEnabled) node.style.height = ''
        return
      }
      resize()
    },
    destroy() {
      node.removeEventListener('input', resize)
      observer.disconnect()
    },
  }
}
