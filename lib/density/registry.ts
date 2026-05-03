// Density registry — three named density values, each with its
// full sizing-token map. Values are pinned per
// docs/ui/foundations/spacing.md → Density toggle. Three densities
// total: compact (desktop default), regular (phone+tablet default),
// comfortable (user opt-in for either tier).
import type { DensityTokens, DensityValue } from './types'

export const densityTokens: Record<DensityValue, DensityTokens> = {
  compact: {
    '--control-h-xs': '32px',
    '--control-h-sm': '36px',
    '--control-h-md': '40px',
    '--control-h-lg': '44px',
    '--row-py-xs': '4px',
    '--row-py-sm': '6px',
    '--row-py-md': '6px',
    '--row-py-lg': '8px',
    '--row-px-xs': '6px',
    '--row-px-sm': '8px',
    '--row-px-md': '8px',
    '--row-px-lg': '12px',
  },
  regular: {
    '--control-h-xs': '36px',
    '--control-h-sm': '40px',
    '--control-h-md': '44px',
    '--control-h-lg': '48px',
    '--row-py-xs': '8px',
    '--row-py-sm': '10px',
    '--row-py-md': '12px',
    '--row-py-lg': '16px',
    '--row-px-xs': '8px',
    '--row-px-sm': '10px',
    '--row-px-md': '12px',
    '--row-px-lg': '16px',
  },
  comfortable: {
    '--control-h-xs': '40px',
    '--control-h-sm': '44px',
    '--control-h-md': '48px',
    '--control-h-lg': '56px',
    '--row-py-xs': '10px',
    '--row-py-sm': '12px',
    '--row-py-md': '16px',
    '--row-py-lg': '20px',
    '--row-px-xs': '10px',
    '--row-px-sm': '12px',
    '--row-px-md': '16px',
    '--row-px-lg': '20px',
  },
}
