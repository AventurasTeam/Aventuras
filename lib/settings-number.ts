/**
 * Coerce a `stories.settings` count to a usable integer; `floor` is both minimum and non-finite
 * fallback. Load-bearing for `classifierContextEntries`, unbounded in the schema, so hand-edits can
 * be fractional/negative/`Infinity`/`NaN`.
 */
export function settingsCount(value: number, floor: number): number {
  return Number.isFinite(value) ? Math.max(floor, Math.floor(value)) : floor
}
