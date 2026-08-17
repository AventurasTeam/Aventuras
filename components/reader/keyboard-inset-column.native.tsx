import type { ReactNode } from 'react'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Reserves the soft keyboard's height at the bottom of the reader column so the
 * composer stays above it.
 *
 * Padding, not translation: the reader above holds `flex-1`, so it compresses
 * and the newest entry stays visible directly above the input while the top bar
 * holds still.
 *
 * The composer is the bottom-most element of a full-height column, so its
 * overlap with the keyboard is exactly the keyboard height — no runtime screen
 * position is involved. That is why this drives padding off the animation hook
 * rather than using the library's `KeyboardAvoidingView`, whose one-shot
 * `viewPositionInWindow` measurement exists for containers that could be
 * anywhere on screen. See
 * lessons-learned/kav-automatic-offset-animation-race.md.
 */
export function KeyboardInsetColumn({ children }: { children: ReactNode }) {
  const keyboard = useReanimatedKeyboardAnimation()
  const { bottom } = useSafeAreaInsets()

  const style = useAnimatedStyle(() => ({
    flex: 1,
    // `height` runs negative while the keyboard is up. ScreenShell already pads
    // the bottom safe area, so subtract whatever it contributes right now —
    // correct whether or not the platform zeroes that inset while the IME shows.
    paddingBottom: Math.max(0, -keyboard.height.get() - bottom),
  }))

  return <Animated.View style={style}>{children}</Animated.View>
}
