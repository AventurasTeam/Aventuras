import { useContext } from 'react'
import { DensityContext, type DensityContextValue } from './density-context'

export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext)
  if (!ctx) throw new Error('useDensity must be used within a DensityProvider')
  return ctx
}
