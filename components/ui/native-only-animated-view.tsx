// Wrapper around reanimated's Animated.View that no-ops on web and renders
// the animated view on native. Used by overlay primitives to avoid running
// reanimated worklets on Electron / RN-Web (where the layout-animation API
// would render statically anyway). Vendored from the react-native-reusables
// CLI scaffold — small enough that we own it directly.
import { Platform } from 'react-native'
import Animated from 'react-native-reanimated'

function NativeOnlyAnimatedView(
  props: React.ComponentProps<typeof Animated.View> & React.RefAttributes<typeof Animated.View>,
) {
  if (Platform.OS === 'web') {
    return <>{props.children as React.ReactNode}</>
  }
  return <Animated.View {...props} />
}

export { NativeOnlyAnimatedView }
