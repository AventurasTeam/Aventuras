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
