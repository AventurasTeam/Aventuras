import { View, type ViewStyle } from 'react-native'

import { POINTER_EVENTS_NONE } from '@/constants/styles'
import type { RecentlyClassified } from '@/lib/row-signals'

// zIndex -1 drops the layer under the control's in-flow content: on web the glyph svg is static and
// an absolute sibling would paint over it whatever the JSX order.
const TINT_STYLE = { ...POINTER_EVENTS_NONE, zIndex: -1 } satisfies ViewStyle
const FADING_STYLE = { ...TINT_STYLE, opacity: 0.5 } satisfies ViewStyle

export type TintLayerProps = { tint: RecentlyClassified | undefined; testID?: string }

/**
 * The recently-classified tint behind a rail control: full when fresh, half when fading, nothing
 * otherwise. Its negative `zIndex` keeps the control's content drawing over it at full contrast,
 * wherever the layer sits among its siblings.
 */
export function TintLayer({ tint, testID }: TintLayerProps) {
  if (tint == null) return null
  return (
    <View
      testID={testID}
      aria-hidden
      className="absolute inset-0 bg-recently-classified-bg"
      style={tint === 'fading' ? FADING_STYLE : TINT_STYLE}
    />
  )
}
