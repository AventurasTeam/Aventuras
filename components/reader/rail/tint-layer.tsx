import { View, type ViewStyle } from 'react-native'

import { POINTER_EVENTS_NONE } from '@/constants/styles'
import type { RecentlyClassified } from '@/lib/row-signals'

// Opacity in style, not opacity-50: story plays read it, and NativeWind doesn't run under vitest.
const FADING_STYLE = { ...POINTER_EVENTS_NONE, opacity: 0.5 } satisfies ViewStyle

export type TintLayerProps = { tint: RecentlyClassified | undefined; testID?: string }

/**
 * The recently-classified tint behind a rail control: full when fresh, half when fading, nothing
 * otherwise. Render it first, so the control's content draws over it at full contrast.
 */
export function TintLayer({ tint, testID }: TintLayerProps) {
  if (tint == null) return null
  return (
    <View
      testID={testID}
      aria-hidden
      className="absolute inset-0 bg-recently-classified-bg"
      style={tint === 'fading' ? FADING_STYLE : POINTER_EVENTS_NONE}
    />
  )
}
