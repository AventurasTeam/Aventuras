import { describe, expect, it } from 'vitest'
import {
  ACTION_CHOICES_PANEL_DEFAULTS,
  ACTION_CHOICES_PANEL_WIDTH,
  normalizeActionChoicesPanelWidth,
} from './uiLayoutSettings'

describe('action choices side-panel settings', () => {
  it('keeps the side-panel layout opt-in', () => {
    expect(ACTION_CHOICES_PANEL_DEFAULTS.enabled).toBe(false)
    expect(ACTION_CHOICES_PANEL_DEFAULTS.width).toBe(ACTION_CHOICES_PANEL_WIDTH.default)
  })

  it('normalizes persisted and user-selected widths to the supported range', () => {
    expect(normalizeActionChoicesPanelWidth(ACTION_CHOICES_PANEL_WIDTH.min - 10)).toBe(
      ACTION_CHOICES_PANEL_WIDTH.min,
    )
    expect(normalizeActionChoicesPanelWidth(31.6)).toBe(32)
    expect(normalizeActionChoicesPanelWidth(ACTION_CHOICES_PANEL_WIDTH.max + 10)).toBe(
      ACTION_CHOICES_PANEL_WIDTH.max,
    )
    expect(normalizeActionChoicesPanelWidth(Number.NaN)).toBe(ACTION_CHOICES_PANEL_WIDTH.default)
  })
})
