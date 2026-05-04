// Aventuras Skeleton primitive — Phase 2 Group F.
//
// Placeholder block for loading states — list rows during
// hydration, detail-pane head before entity load, etc. The
// pulsing motion communicates "content arriving"; the muted
// surface communicates "this isn't real content yet."
//
// Per-platform dispatch (Sheet/Spinner pattern):
//
// - **Web** — `animate-pulse` (Tailwind built-in: opacity 1 → 0.5
//   → 1 over 2 s, ease-in-out, infinite). Pure CSS, no JS.
// - **Native** — reanimated worklet with `withRepeat` + `withTiming`
//   driving opacity. Mirrors the web keyframes (1 → 0.5 → 1) so
//   the visual cadence matches across platforms.
//
// Slot choice — `bg-fg-muted`:
//
// Skeletons need to read as visible-but-quiet placeholder shapes
// on `bg-base`. `bg-bg-sunken` was ruled out (same hole that hit
// Avatar — invisible on cyberpunk / fallen-down / parchment /
// catppuccin-latte where sunken sits within ~1-3 % of base).
// `bg-fg-muted` matches Switch's off-track precedent; theme-tint
// is acceptable here because the pulse animation carries the
// loading semantic regardless of color.
//
// Why not a dedicated `--skeleton-bg` slot: only one consumer for
// now (this primitive). If more static-neutral surfaces accrue, a
// dedicated slot is the right escalation; until then, borrowing
// `fg-muted` keeps registry.ts terse.
//
// API contract:
//
// Dimensions are className-driven (`<Skeleton className="h-4
// w-32" />`); the primitive is intentionally shapeless so
// consumers compose blocks matching their loading layout
// (avatar-sized circles, line-of-text bars, multi-line paragraph
// stacks). `rounded-md` is the default shape; override per-use.

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
