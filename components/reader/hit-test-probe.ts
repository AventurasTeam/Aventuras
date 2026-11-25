// Play helpers for hit-testing stacked layers. Stories import this; app code never does.

/** The topmost element at the centre of `element`, where a real tap there lands. */
export function hitAtCentre(element: Element): Element | null {
  const box = element.getBoundingClientRect()
  return document.elementFromPoint(
    Math.floor(box.left + box.width / 2),
    Math.floor(box.top + box.height / 2),
  )
}

// An open modal turns a lower layer's pointer events off, and hit-testing skips such an element
// whatever paints there: the layer under test takes them back for the probe alone.
export function withHitTesting<T>(layer: HTMLElement, probe: () => T): T {
  const previous = layer.style.pointerEvents
  layer.style.pointerEvents = 'auto'
  try {
    return probe()
  } finally {
    layer.style.pointerEvents = previous
  }
}
