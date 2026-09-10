/**
 * Coerce a hand-editable `stories.settings` number to a usable integer.
 *
 * `storySettingsSchema` avoids `.int()` so a hand-edited blob degrades rather than
 * refusing to open the story — a value may be fractional, negative, `Infinity` or `NaN`.
 * `floor` is both the minimum and the fallback: a non-finite value has no magnitude.
 */
export function settingsCount(value: number, floor: number): number {
  return Number.isFinite(value) ? Math.max(floor, Math.floor(value)) : floor
}
