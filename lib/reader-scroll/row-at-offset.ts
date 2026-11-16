// lib/reader-scroll/row-at-offset.ts
/**
 * Binary search for the first of `count` rows (document order) whose bottom edge lies below `y`.
 * The last row when every row ends above `y` (a tall streaming card can fill the viewport below
 * them all); null when there are none. `rowBottom` reads in the scroller's content coordinates.
 */
export function rowAtOffset(
  count: number,
  rowBottom: (index: number) => number,
  y: number,
): number | null {
  if (count === 0) return null
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rowBottom(mid) > y) hi = mid
    else lo = mid + 1
  }
  return lo
}
