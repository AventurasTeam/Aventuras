// Density-aware sizing tokens. Values are CSS-pixel literals (e.g.
// '40px') so they can be applied verbatim as CSS vars (web) or
// literal style values via NativeWind `vars()` (native). See
// docs/ui/foundations/spacing.md → Density toggle.

export type DensityValue = 'compact' | 'regular' | 'comfortable'

// User-facing setting includes the sentinel `'default'` which
// resolves per tier (compact on desktop, regular on phone+tablet).
// The sentinel is stored, not the resolved value, so tier-default
// rules can change later without migrating user data.
export type DensitySetting = 'default' | DensityValue

export type DensityTokens = {
  // Height-driven — fixed-height controls (Trigger, Button, Input)
  '--control-h-xs': string
  '--control-h-sm': string
  '--control-h-md': string
  '--control-h-lg': string
  // Padding-driven (vertical) — rows
  '--row-py-xs': string
  '--row-py-sm': string
  '--row-py-md': string
  '--row-py-lg': string
  // Padding-driven (horizontal) — rows
  '--row-px-xs': string
  '--row-px-sm': string
  '--row-px-md': string
  '--row-px-lg': string
}

export const DENSITY_TOKEN_KEYS = [
  '--control-h-xs',
  '--control-h-sm',
  '--control-h-md',
  '--control-h-lg',
  '--row-py-xs',
  '--row-py-sm',
  '--row-py-md',
  '--row-py-lg',
  '--row-px-xs',
  '--row-px-sm',
  '--row-px-md',
  '--row-px-lg',
] as const satisfies readonly (keyof DensityTokens)[]

export const DENSITY_VALUES = [
  'compact',
  'regular',
  'comfortable',
] as const satisfies readonly DensityValue[]
