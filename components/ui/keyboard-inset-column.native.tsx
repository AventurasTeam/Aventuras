import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { cn } from '@/lib/utils'

/**
 * Reserves the soft keyboard's height below its children so a bottom-anchored
 * control stays above it — the reader's composer, Story Settings' save bar.
 * Padding, not translation: the column holds `flex-1`, so it compresses and
 * the content above keeps its top edge. Hand-driven off the animation hook
 * rather than the library's `KeyboardAvoidingView` — see
 * lessons-learned/kav-automatic-offset-animation-race.md.
 */
export function KeyboardInsetColumn({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const keyboard = useReanimatedKeyboardAnimation()
  const { bottom } = useSafeAreaInsets()

  const style = useAnimatedStyle(() => ({
    flex: 1,
    // `height` runs negative while the keyboard is up. ScreenShell already pads
    // the bottom safe area, so subtract whatever it contributes right now —
    // correct whether or not the platform zeroes that inset while the IME shows.
    paddingBottom: Math.max(0, -keyboard.height.get() - bottom),
  }))

  return (
    <Animated.View style={style}>
      {/* Classes live on this plain View: NativeWind registers cssInterop for RN
          core components only, so className on a Reanimated Animated.* is
          dropped, not applied — same reason as components/ui/accordion.tsx. */}
      <View className={cn('flex-1', className)}>{children}</View>
    </Animated.View>
  )
}
