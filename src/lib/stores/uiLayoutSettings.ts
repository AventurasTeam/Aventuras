export const ACTION_CHOICES_PANEL_WIDTH = {
  // Keep a broad safety envelope for persisted values without dictating a desktop layout.
  // CSS may shrink the preferred width when the current window cannot fit both columns.
  min: 16,
  max: 160,
  default: 32,
} as const

export const ACTION_CHOICES_PANEL_DEFAULTS = {
  enabled: false,
  width: ACTION_CHOICES_PANEL_WIDTH.default,
} as const

/**
 * Settings are stored as untyped strings, so clamp both old/corrupt persisted values and
 * values supplied by UI controls before publishing them to the layout's CSS variable.
 */
export function normalizeActionChoicesPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return ACTION_CHOICES_PANEL_WIDTH.default
  return Math.min(
    ACTION_CHOICES_PANEL_WIDTH.max,
    Math.max(ACTION_CHOICES_PANEL_WIDTH.min, Math.round(width)),
  )
}
