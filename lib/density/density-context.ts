import { createContext } from 'react'
import type { DensitySetting, DensityValue } from './types'

export type DensityContextValue = {
  // The user's stored choice — sentinel 'default' or one of the
  // three explicit values.
  setting: DensitySetting
  // The resolved density actually applied (sentinel resolved per
  // tier).
  resolved: DensityValue
  setSetting: (setting: DensitySetting) => void
}

export const DensityContext = createContext<DensityContextValue | null>(null)
