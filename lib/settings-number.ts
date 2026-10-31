/**
 * Coerce a `stories.settings` count to a usable integer at its read site.
 *
 * Load-bearing for two keys: `classifierContextEntries` has no bounds in `storySettingsSchema`, so
 * a hand-edited value may be fractional, negative, `Infinity` or `NaN`, and this enforces its
 * minimum; `partialChapterBuffer` may be a valid 0 under a floor of 1.
 * `floor` is both the minimum and the fallback: a non-finite value has no magnitude.
 */
export function settingsCount(value: number, floor: number): number {
  return Number.isFinite(value) ? Math.max(floor, Math.floor(value)) : floor
}
