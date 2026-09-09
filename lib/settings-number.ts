/**
 * Coerce a hand-editable `stories.settings` number to a usable integer.
 *
 * `storySettingsSchema` deliberately avoids `.int()` so a hand-edited blob
 * degrades instead of refusing to open the story, which leaves every read site
 * holding a number that may be fractional, negative, `Infinity` or `NaN`. Each
 * such site had grown its own copy of this expression; they are one function
 * with different floors.
 *
 * `floor` is both the minimum and the fallback: a non-finite value has no
 * usable magnitude, so the only honest answer is the smallest legal one.
 */
export function settingsCount(value: number, floor: number): number {
  return Number.isFinite(value) ? Math.max(floor, Math.floor(value)) : floor
}
