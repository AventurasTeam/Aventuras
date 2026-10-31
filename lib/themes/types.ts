export type ThemeMode = 'light' | 'dark'

export type ThemeColorSlots = {
  // Backgrounds (5)
  '--bg-base': string
  '--bg-raised': string
  '--bg-sunken': string
  '--bg-overlay': string
  '--bg-disabled': string
  // Foregrounds (4)
  '--fg-primary': string
  '--fg-secondary': string
  '--fg-muted': string
  '--fg-disabled': string
  // Accent (3)
  '--accent': string
  '--accent-hover': string
  '--accent-fg': string
  // Semantic states (12)
  '--success': string
  '--success-fg': string
  '--success-text': string
  '--warning': string
  '--warning-fg': string
  '--warning-text': string
  '--danger': string
  '--danger-fg': string
  '--danger-text': string
  '--info': string
  '--info-fg': string
  '--info-text': string
  // Borders (2)
  '--border': string
  '--border-strong': string
  // Focus (1)
  '--focus-ring': string
  // Selection (1)
  '--selection-bg': string
  // Pattern-driven (1)
  '--recently-classified-bg': string
  // State-layer tints (2)
  '--tint-hover': string
  '--tint-press': string
}

export type ThemeFontOverrides = Partial<{
  '--font-reading': string
  '--font-ui': string
  '--font-mono': string
}>

export type Theme = {
  id: string
  name: string
  mode: ThemeMode
  colors: ThemeColorSlots
  fonts?: ThemeFontOverrides
  accentOverridable: boolean
}

export const COLOR_SLOT_KEYS = [
  '--bg-base',
  '--bg-raised',
  '--bg-sunken',
  '--bg-overlay',
  '--bg-disabled',
  '--fg-primary',
  '--fg-secondary',
  '--fg-muted',
  '--fg-disabled',
  '--accent',
  '--accent-hover',
  '--accent-fg',
  '--success',
  '--success-fg',
  '--success-text',
  '--warning',
  '--warning-fg',
  '--warning-text',
  '--danger',
  '--danger-fg',
  '--danger-text',
  '--info',
  '--info-fg',
  '--info-text',
  '--border',
  '--border-strong',
  '--focus-ring',
  '--selection-bg',
  '--recently-classified-bg',
  '--tint-hover',
  '--tint-press',
] as const satisfies readonly (keyof ThemeColorSlots)[]
