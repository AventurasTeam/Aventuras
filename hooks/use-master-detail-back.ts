import { useFocusEffect } from 'expo-router'
import { useCallback, useRef } from 'react'
import { BackHandler, Platform } from 'react-native'

/**
 * Android hardware-back for a master-detail surface. While `canCollapse` is
 * true the handler runs `onCollapse` and swallows the event; while false it
 * falls through to the default route-pop. Pass "detail is open" for the plain
 * phone case, or a constant `true` where the surface must own every back —
 * a route guarding unsaved changes has to intercept on tablet / desktop too,
 * where no collapse state exists. Android-only: RN-Web's `BackHandler` shim
 * console.errors on every subscribe, so the platform check gates the listener
 * rather than the handler.
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
      if (Platform.OS !== 'android') return undefined
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
