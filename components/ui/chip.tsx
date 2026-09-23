import { type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Text, TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

// h-control-xs is 36 at regular (the phone default): 36 + 2·4 reaches the 44px phone floor, and
// 4 a side stays inside half of a gap-2 chip row, so neighbours' slop never overlaps.
const CHIP_HIT_SLOP = 4

type ChipProps = {
  selected?: boolean
  onPress?: () => void
  disabled?: boolean
  /** Why it's disabled: a web tooltip over the chip and its accessibility hint. */
  disabledReason?: string
  className?: string
  children?: ReactNode
}

export function Chip({
  selected = false,
  onPress,
  disabled,
  disabledReason,
  className,
  children,
}: ChipProps) {
  const interactive = onPress != null
  const baseClass = cn(
    // `group` on a static View makes NativeWind upgrade it to a Pressable that eats the parent's tap.
    interactive && 'group',
    'h-control-xs flex-row items-center justify-center rounded-sm border px-row-x-sm',
    selected ? 'border-fg-primary bg-fg-primary' : 'border-border-strong bg-bg-base',
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
    <ReasonTooltip reason={disabled ? disabledReason : undefined}>
      <Pressable
        role="button"
        accessibilityRole="button"
        aria-pressed={selected}
        accessibilityState={{ selected, disabled: !!disabled }}
        accessibilityHint={disabled ? disabledReason : undefined}
        disabled={disabled}
        onPress={onPress}
        hitSlop={CHIP_HIT_SLOP}
        className={baseClass}
      >
        {content}
      </Pressable>
    </ReasonTooltip>
  )
}

export type { ChipProps }
