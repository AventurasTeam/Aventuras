// Width-based tier hook backing form-factor-dependent dispatch
// (Select's phone Sheet swap, cardinality threshold bump, future
// sheet-dismissal-on-tier-transition behavior). Boundaries match
// docs/ui/foundations/mobile/responsive.md.
import { useWindowDimensions } from 'react-native'

export type Tier = 'phone' | 'tablet' | 'desktop'

const PHONE_MAX = 640
const TABLET_MAX = 1024

export function tierForWidth(width: number): Tier {
  if (width < PHONE_MAX) return 'phone'
  if (width < TABLET_MAX) return 'tablet'
  return 'desktop'
}

export function useTier(): Tier {
  const { width } = useWindowDimensions()
  return tierForWidth(width)
}
