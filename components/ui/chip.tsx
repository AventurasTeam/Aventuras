import { type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Text, TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type ChipProps = {
  selected?: boolean
  onPress?: () => void
  disabled?: boolean
  className?: string
  children?: ReactNode
}

export function Chip({ selected = false, onPress, disabled, className, children }: ChipProps) {
  const interactive = onPress != null
  const baseClass = cn(
    'group h-control-xs flex-row items-center justify-center rounded-sm border px-row-x-sm',
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
