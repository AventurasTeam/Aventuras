import { useFocusEffect } from 'expo-router'
import { useCallback, useRef } from 'react'
import { BackHandler } from 'react-native'

/**
 * Android hardware-back for a phone master-detail surface: while a row is
 * selected (detail open), back collapses to the list instead of exiting the
 * route; otherwise it falls through to the default route-pop. No-op on
 * tablet / desktop (pass `canCollapse: false`).
 *
 * Lives in a route-level hook rather than in `MasterDetailLayout` because
 * `useFocusEffect` needs a navigation context, and the shell renders in
 * Storybook without one — calling it there would throw.
 */
export function useMasterDetailBack(canCollapse: boolean, onCollapse: () => void): void {
  // Latest-ref so the effect re-subscribes only when canCollapse flips, not on
  // every render that hands us a fresh onCollapse closure.
  const onCollapseRef = useRef(onCollapse)
  onCollapseRef.current = onCollapse

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        if (!canCollapse) return false
        onCollapseRef.current()
        return true
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack)
      return () => sub.remove()
    }, [canCollapse]),
  )
}
