import { useEffect, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { RAIL_STRIP_WIDTH_PX } from './rail-strip'

export const RAIL_WIDTH_PX = 300
export const RAIL_SLIDE_MS = 150

export type RailColumnProps = {
  collapsed: boolean
  /** The full rail; it stays mounted through a collapse until the width reaches the strip's. */
  expanded: ReactNode
  strip: ReactNode
}

export function RailColumn({ collapsed, expanded, strip }: RailColumnProps) {
  const width = useSharedValue(collapsed ? RAIL_STRIP_WIDTH_PX : RAIL_WIDTH_PX)
  const [showStrip, setShowStrip] = useState(collapsed)
  const collapsedRef = useRef(collapsed)

  useEffect(() => {
    collapsedRef.current = collapsed
    if (!collapsed) setShowStrip(false)
    // Reads the latest target, not this closure's: a same-width set completes synchronously, so a
    // mount's settled slide can land after a newer expand.
    const landStrip = () => {
      if (collapsedRef.current) setShowStrip(true)
    }
    width.set(
      withTiming(
        collapsed ? RAIL_STRIP_WIDTH_PX : RAIL_WIDTH_PX,
        {
          duration: RAIL_SLIDE_MS,
          easing: collapsed ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        },
        (finished) => {
          'worklet'
          if (finished && collapsed) scheduleOnRN(landStrip)
        },
      ),
    )
  }, [collapsed, width])

  const widthStyle = useAnimatedStyle(() => ({ width: width.get() }), [width])

  return (
    <View testID="rail-column" className="border-l border-border bg-bg-sunken">
      <Animated.View style={[styles.clip, widthStyle]}>
        <View style={showStrip ? styles.strip : styles.rail}>{showStrip ? strip : expanded}</View>
      </Animated.View>
    </View>
  )
}

// Style, not className: NativeWind never styles an Animated view, and both widths are constants.
// Left-anchored at full width, the content slides with the column's moving left edge.
const styles = StyleSheet.create({
  clip: { flex: 1, overflow: 'hidden' },
  rail: { position: 'absolute', top: 0, bottom: 0, left: 0, width: RAIL_WIDTH_PX },
  strip: { position: 'absolute', top: 0, bottom: 0, left: 0, width: RAIL_STRIP_WIDTH_PX },
})
