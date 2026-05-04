import * as React from 'react'
import { Platform, View, type ViewProps } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { cn } from '@/lib/utils'

type SkeletonProps = ViewProps & {
  className?: string
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  if (Platform.OS === 'web') {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Loading"
        className={cn('animate-pulse rounded-md bg-fg-muted', className)}
        {...props}
      />
    )
  }
  return <NativeSkeleton className={className} {...props} />
}

// Native-only branch. Lives behind the `Platform.OS === 'web'`
// guard above so reanimated worklets don't mount on RN-Web (where
// the same animate-pulse CSS does the work natively).
function NativeSkeleton({ className, ...props }: SkeletonProps) {
  const opacity = useSharedValue(1)
  React.useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.5, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    )
  }, [opacity])
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      className={cn('rounded-md bg-fg-muted', className)}
      style={animatedStyle}
      {...props}
    />
  )
}

export type { SkeletonProps }
