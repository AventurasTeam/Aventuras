export interface PinSnapshot {
  height: number
  layout: string
}

export interface PinInput {
  height: number
  windowStart: number
  windowEnd: number
  entryCount: number
  autoScroll: boolean
  userScrolledUp: boolean
  hiddenAtBottom: number
  editing: boolean
  switchingBranch: boolean
}

/**
 * Whether a reader pinned to the bottom should be pinned again after a render pass.
 *
 * Only a height change that arrives with the layout the last height change had counts as an
 * in-place resize (a banner appearing, a summary edited, choices showing). The height is
 * ResizeObserver-backed, so a count or window change is seen one run before its height change;
 * the snapshot's layout advances only with the height so that pair is not mistaken for a resize.
 */
export function repinDecision(
  prev: PinSnapshot | null,
  input: PinInput,
): { repin: boolean; snapshot: PinSnapshot } {
  const layout = `${input.windowStart}:${input.windowEnd}:${input.entryCount}`
  if (!prev) return { repin: false, snapshot: { height: input.height, layout } }

  const heightChanged = input.height !== prev.height
  const snapshot = heightChanged ? { height: input.height, layout } : prev

  const repin =
    heightChanged &&
    layout === prev.layout &&
    input.autoScroll &&
    !input.userScrolledUp &&
    input.hiddenAtBottom === 0 &&
    !input.editing &&
    !input.switchingBranch

  return { repin, snapshot }
}
