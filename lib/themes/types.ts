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
  // Semantic states (8)
  '--success': string
  '--success-fg': string
  '--warning': string
  '--warning-fg': string
  '--danger': string
  '--danger-fg': string
  '--info': string
  '--info-fg': string
  // Borders (2)
  '--border': string
  '--border-strong': string
  // Focus (1)
  '--focus-ring': string
  // Selection (1)
  '--selection-bg': string
  // Pattern-driven (1)
  '--recently-classified-bg': string
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
  '--warning',
  '--warning-fg',
  '--danger',
  '--danger-fg',
  '--info',
  '--info-fg',
  '--border',
  '--border-strong',
  '--focus-ring',
  '--selection-bg',
  '--recently-classified-bg',
] as const satisfies readonly (keyof ThemeColorSlots)[]
