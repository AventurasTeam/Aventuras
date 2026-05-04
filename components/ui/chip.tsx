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
    'flex-row items-center justify-center rounded-sm border px-3 py-1',
    selected
      ? 'border-fg-primary bg-fg-primary'
      : cn(
          'border-border-strong bg-bg-base',
          interactive && Platform.select({ web: 'hover:text-fg-primary' }),
        ),
    Platform.select({
      web: cn(
        interactive && 'cursor-pointer outline-none transition-colors',
        interactive && 'focus-visible:ring-2 focus-visible:ring-focus-ring',
        disabled && 'cursor-not-allowed',
      ),
    }),
    disabled && 'opacity-50',
    className,
  )

  const textClass = cn('text-xs font-medium', selected ? 'text-bg-base' : 'text-fg-muted')

  const content =
    typeof children === 'string' ? (
      <Text size="xs" className={cn('font-medium', selected ? 'text-bg-base' : 'text-fg-muted')}>
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
