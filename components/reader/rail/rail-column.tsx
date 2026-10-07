import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { RAIL_STRIP_WIDTH_PX } from './rail-strip'

const RAIL_WIDTH_PX = 300
const RAIL_SLIDE_MS = 150

export type RailColumnProps = {
  collapsed: boolean
  /** The full rail; it stays mounted through a collapse until the width reaches the strip's. */
  expanded: ReactNode
  strip: ReactNode
  /**
   * Web: each side's toggle. A swap that unmounts the focused control hands focus to the incoming
   * side's; focus outside the column never moves.
   */
  expandedToggleRef?: RefObject<View | null>
  stripToggleRef?: RefObject<View | null>
}

export function RailColumn({
  collapsed,
  expanded,
  strip,
  expandedToggleRef,
  stripToggleRef,
}: RailColumnProps) {
  const width = useSharedValue(collapsed ? RAIL_STRIP_WIDTH_PX : RAIL_WIDTH_PX)
  const [showStrip, setShowStrip] = useState(collapsed)
  const collapsedRef = useRef(collapsed)
  const columnRef = useRef<View>(null)
  // Read just before each swap, while the outgoing side is still in the DOM.
  const refocusRef = useRef(false)

  useEffect(() => {
    collapsedRef.current = collapsed
    if (!collapsed) {
      refocusRef.current = holdsFocus(columnRef.current)
      setShowStrip(false)
    }
    // Reads the latest target, not this closure's: a same-width set completes synchronously, so a
    // mount's settled slide can land after a newer expand.
    const landStrip = () => {
      if (!collapsedRef.current) return
      refocusRef.current = holdsFocus(columnRef.current)
      setShowStrip(true)
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

  useEffect(() => {
    if (!refocusRef.current) return
    refocusRef.current = false
    const toggle = showStrip ? stripToggleRef?.current : expandedToggleRef?.current
    ;(toggle as unknown as Partial<HTMLElement> | null | undefined)?.focus?.()
  }, [showStrip, expandedToggleRef, stripToggleRef])

  const widthStyle = useAnimatedStyle(() => ({ width: width.get() }), [width])

  return (
    <View ref={columnRef} testID="rail-column" className="border-l border-border bg-bg-sunken">
      <Animated.View style={[styles.clip, widthStyle]}>
        <View style={showStrip ? styles.strip : styles.rail}>{showStrip ? strip : expanded}</View>
      </Animated.View>
    </View>
  )
}

function holdsFocus(column: View | null): boolean {
  if (Platform.OS !== 'web' || column == null) return false
  return (column as unknown as HTMLElement).contains(document.activeElement)
}

// Style, not className: NativeWind never styles an Animated view, and both widths are constants.
// Left-anchored at full width, the content slides with the column's moving left edge.
const styles = StyleSheet.create({
  clip: { flex: 1, overflow: 'hidden' },
  rail: { position: 'absolute', top: 0, bottom: 0, left: 0, width: RAIL_WIDTH_PX },
  strip: { position: 'absolute', top: 0, bottom: 0, left: 0, width: RAIL_STRIP_WIDTH_PX },
})
