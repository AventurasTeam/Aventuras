import * as React from 'react'
import { ActivityIndicator, Platform, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'

import type { ThemeColorSlots } from '@/lib/themes/types'
import { useTheme } from '@/lib/themes/use-theme'

const SPINNER_PX = {
  sm: 16,
  md: 20,
  lg: 24,
} as const

type SpinnerSize = keyof typeof SPINNER_PX

type SpinnerProps = {
  /** `'sm'` / `'md'` / `'lg'` matches Icon's 16/20/24 scale. Numeric override accepted. */
  size?: SpinnerSize | number
  /**
   * Theme slot driving the spinner color (e.g. `'--fg-primary'`,
   * `'--accent'`, `'--danger-fg'`). Slot-based rather than className
   * because native ActivityIndicator can't pick up `text-*` via CSS
   * cascade (no DOM on RN). Defaults to `--fg-primary`.
   */
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

export { SPINNER_PX }
export type { SpinnerProps, SpinnerSize }
