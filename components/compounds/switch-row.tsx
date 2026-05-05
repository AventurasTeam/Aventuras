import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'

import { SwitchVisual } from '@/components/ui/switch-visual'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type SwitchRowProps = {
  /** Setting label. Doubles as the accessible name for the row's switch role. */
  label: string
  /** Optional secondary line below the label — explanatory hint, not interactive. */
  hint?: string
  /**
   * Optional content placed before the label/hint stack (e.g. a status icon).
   * Sits inside the row's tap surface, so taps on it still toggle. When
   * present the row aligns top so the leading element, label baseline, and
   * switch line up rather than the switch floating to the text-body's
   * vertical center.
   */
  leading?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function SwitchRow({
  label,
  hint,
  leading,
  checked,
  onCheckedChange,
  disabled,
  className,
}: SwitchRowProps) {
  const hasLeading = leading != null
  return (
    <Pressable
      role="switch"
      aria-checked={checked}
      aria-label={label}
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onCheckedChange(!checked)}
      className={cn(
        'flex-row gap-3 rounded-md px-row-x-md py-row-y-md',
        hasLeading ? 'items-start' : 'items-center',
        'active:bg-tint-press',
        Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
        disabled && 'opacity-50',
        Platform.select({ web: disabled && 'cursor-not-allowed' }),
        className,
      )}
    >
      {hasLeading ? <View className="mt-0.5">{leading}</View> : null}
      <View className="flex-1 gap-0.5">
        <Text className="font-medium">{label}</Text>
        {hint != null ? (
          <Text variant="muted" size="sm">
            {hint}
          </Text>
        ) : null}
      </View>
      <SwitchVisual checked={checked} disabled={disabled} className={hasLeading ? 'mt-0.5' : ''} />
    </Pressable>
  )
}

export type { SwitchRowProps }
