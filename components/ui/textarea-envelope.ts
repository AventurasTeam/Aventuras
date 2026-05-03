// Pure height-envelope math for the Textarea primitive. Lives in
// its own module so the unit test can import without dragging in
// NativeWind / RN / density-context — vitest's unit project has no
// `@/` alias, so keeping this dependency-free is the cheapest path
// to test isolation.

// Matches `text-sm` (14px) at NativeWind's default leading-5
// (line-height: 1.25rem = 20px). If we ever swap Textarea's text
// size, update this.
export const TEXTAREA_LINE_HEIGHT_PX = 20

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function computeTextareaEnvelope(
  rows: number,
  maxRows: number,
  padY: number,
  lineHeight = TEXTAREA_LINE_HEIGHT_PX,
): { minHeight: number; maxHeight: number } {
  return {
    minHeight: rows * lineHeight + padY * 2,
    maxHeight: maxRows * lineHeight + padY * 2,
  }
}
