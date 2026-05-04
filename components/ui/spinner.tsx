// Aventuras Spinner primitive — Phase 2 Group F.
//
// Replaces the `<ActivityIndicator>` workaround that lived in Button's
// `loading` branch with a proper cross-platform primitive. Phase 1
// noted Button's spinner-color plumbing as a temporary measure
// pending this primitive; Group F lands the real shape.
//
// Per-platform dispatch (same pattern Sheet/Popover established via
// `NativeOnlyAnimatedView`):
//
// - **Web** — pure CSS spinner. SVG ring drawn with `stroke=
//   "currentColor"` and `animate-spin` (Tailwind's built-in 1 s
//   linear infinite rotate keyframes). The wrapper View sets a
//   `text-*` color class so `currentColor` resolves via the CSS
//   cascade. Caller styles color via `className` (e.g. `text-fg-
//   muted`).
// - **Native** — RN's `<ActivityIndicator>`. Battle-tested platform
//   spinner; accepts `color` and `size`. RN-Web has no DOM cascade
//   on native — same constraint that drove Icon's cssInterop color
//   pipe — so color is resolved JS-side from the active theme via
//   `useTheme()` and passed as the `color` prop.
//
// Color contract — `colorSlot` prop:
//
// Both platforms read from a typed theme slot (`'--fg-primary'` /
// `'--accent-fg'` / etc.). Web emits `style={{ color: var(--slot) }}`
// so SVG `currentColor` resolves correctly under per-row
// `[data-theme]` scoping in ThemeMatrix; native reads
// `theme.colors[slot]` directly. Same lookup table Button already
// uses for variant-driven spinner color, kept symmetric.
//
// Why not className-driven color: on native, `text-fg-muted` on the
// wrapper View doesn't propagate to ActivityIndicator (no DOM
// cascade, no cssInterop hook into ActivityIndicator's `color`
// prop). Slot-based API ensures both platforms render the same
// color without the leaky-API trap.
//
// Size variant matches Icon's scale (16/20/24) so a Spinner can
// swap into any Icon site without disrupting layout.

import * as React from 'react'
import { ActivityIndicator, Platform, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'

import { useTheme } from '@/lib/themes/use-theme'
import type { ThemeColorSlots } from '@/lib/themes/types'

const SPINNER_PX = {
  sm: 16,
  md: 20,
  lg: 24,
} as const

type SpinnerSize = keyof typeof SPINNER_PX

type SpinnerProps = {
  size?: SpinnerSize | number
  // Theme slot for the spinner color. Defaults to `--fg-primary`.
  // Resolves per-platform: web emits `var(--slot)` so the SVG
  // currentColor resolves under per-row [data-theme] scoping;
  // native reads the active theme directly.
  colorSlot?: keyof ThemeColorSlots
  className?: string
  accessibilityLabel?: string
}

export function Spinner({
  size = 'md',
  colorSlot = '--fg-primary',
  className,
  accessibilityLabel = 'Loading',
}: SpinnerProps) {
  const resolved = typeof size === 'number' ? size : SPINNER_PX[size]
  const { theme } = useTheme()

  // Web emits `var(--slot)` so per-row [data-theme] scoping resolves
  // the spinner color against the local theme (same pattern Button
  // uses for its spinner color); native reads the active theme.
  const strokeColor = Platform.OS === 'web' ? `var(${colorSlot})` : theme.colors[colorSlot]

  if (Platform.OS === 'web') {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel}
        className={className}
        style={{ width: resolved, height: resolved }}
      >
        <Svg
          width={resolved}
          height={resolved}
          viewBox="0 0 24 24"
          fill="none"
          // animate-spin is a Tailwind built-in (1s linear infinite
          // rotate). Web-only branch.
          className="animate-spin"
        >
          {/* Track ring at low opacity — the moving arc reads as
              motion against a faint background of itself. */}
          <Circle
            cx="12"
            cy="12"
            r="10"
            stroke={strokeColor}
            strokeWidth="3"
            strokeOpacity="0.25"
          />
          {/* Arc: ~75 % gap so the rotating quarter reads clearly. */}
          <Circle
            cx="12"
            cy="12"
            r="10"
            stroke={strokeColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="62.83"
            strokeDashoffset="47.12"
          />
        </Svg>
      </View>
    )
  }

  return (
    <ActivityIndicator
      size={resolved}
      color={theme.colors[colorSlot]}
      accessibilityLabel={accessibilityLabel}
    />
  )
}

export type { SpinnerProps, SpinnerSize }
export { SPINNER_PX }
