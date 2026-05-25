import { useEffect } from 'react'
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
  /**
   * Dimensions are className-driven (`h-4 w-32`, `size-10`).
   * `rounded-md` is the default; override per-use.
   */
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

function NativeSkeleton({ className, ...props }: SkeletonProps) {
  const opacity = useSharedValue(1)
  useEffect(() => {
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
