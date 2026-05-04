import { Text, TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'

type ChipProps = {
  /**
   * When true, the chip renders the filled "active" state — primary
   * fill on a primary border, inverted text. When false / undefined,
   * the chip renders the outline + muted-text default. Only meaningful
   * when `onPress` is also supplied (filter use case).
   */
  selected?: boolean
  /**
   * Optional press handler. When present, the chip becomes interactive
   * (cursor-pointer + hover + role="button" + aria-pressed). When
   * absent, the chip renders as a static visual indicator.
   */
  onPress?: () => void
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}

export function Chip({ selected = false, onPress, disabled, className, children }: ChipProps) {
  const interactive = onPress != null
  const baseClass = cn(
    // `group` hooks the wrapper so group-hover can lift the
    // label color on inactive interactive chips (direct hover:
    // doesn't cascade through TextClassContext).
    'group flex-row items-center justify-center rounded-sm border px-3 py-1',
    selected ? 'border-fg-primary bg-fg-primary' : 'border-border-strong bg-bg-base',
    // Hover/press: state-layer tint on the unselected (neutral)
    // bg, opacity reduction on the selected (filled) bg. The
    // state-layer pattern relies on the tint replacing a
    // neutral background — applying it to a filled surface
    // visually inverts (tint is light over light fg-primary,
    // dark over dark, etc.). Opacity is the project's
    // filled-surface hover convention; matches Button's
    // `destructive` variant.
    interactive && (selected ? 'active:opacity-90' : 'active:bg-tint-press'),
    Platform.select({
      web: cn(
        interactive && 'cursor-pointer outline-none transition-colors',
        interactive && (selected ? 'hover:opacity-90' : 'hover:bg-tint-hover'),
        interactive && 'focus-visible:ring-2 focus-visible:ring-focus-ring',
        disabled && 'cursor-not-allowed pointer-events-none',
      ),
    }),
    disabled && 'opacity-50',
    className,
  )

  const textClass = cn(
    'text-xs font-medium',
    selected ? 'text-bg-base' : 'text-fg-muted',
    !selected &&
      interactive &&
      Platform.select({ web: 'transition-colors group-hover:text-fg-primary' }),
  )

  const content =
    typeof children === 'string' ? (
      <Text size="xs" className={textClass}>
        {children}
      </Text>
    ) : (
      <TextClassContext.Provider value={textClass}>{children}</TextClassContext.Provider>
    )

  if (!interactive) {
    return <View className={baseClass}>{content}</View>
  }

  return (
    <Pressable
      role="button"
      accessibilityRole="button"
      aria-pressed={selected}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={baseClass}
    >
      {content}
    </Pressable>
  )
}

export type { ChipProps }
