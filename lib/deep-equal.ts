/** Structural equality over JSON-shaped values: same keys, same values, arrays told from objects. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  // By keys alone, [] and {} (or ['x'] and { 0: 'x' }) would read as one value.
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a as object)
  const bk = Object.keys(b as object)
  if (ak.length !== bk.length) return false
  // Own keys only: `b[k]` would otherwise read an inherited value, such as a parsed `__proto__`.
  return ak.every(
    (k) =>
      Object.hasOwn(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}
