// lib/reader-scroll/row-at-offset.ts
/**
 * The first of `count` rows in document order whose bottom edge lies below `y`, by binary search:
 * the row at that offset, or the nearest below it. The last row when every row ends above `y` (a
 * tall streaming card can fill the viewport below them all); null when there are no rows.
 * `rowBottom` reads a row's bottom edge in the scroller's content coordinates.
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
