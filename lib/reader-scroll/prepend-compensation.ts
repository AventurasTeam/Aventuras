// lib/reader-scroll/prepend-compensation.ts
export type PrependCompensation = { paddingTopPx: number; scrollTopDeltaPx: number }

// reader-composer.md -> Anchor preservation under shifts (web path):
// measure the prepended block, add equivalent top padding before the layout
// commit, scroll by the same delta, then the caller drops the padding next frame.
export function computePrependCompensation(input: {
  prependedBlockHeightPx: number
}): PrependCompensation {
  const h = input.prependedBlockHeightPx
  return { paddingTopPx: h, scrollTopDeltaPx: h }
}
