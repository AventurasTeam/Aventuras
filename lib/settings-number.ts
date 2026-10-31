/**
 * Coerce a `stories.settings` count to a usable integer; `floor` is both minimum and non-finite
 * fallback. `classifierContextEntries` is unbounded, so a hand-edit can be fractional or negative.
 */
export function settingsCount(value: number, floor: number): number {
  return Number.isFinite(value) ? Math.max(floor, Math.floor(value)) : floor
}
