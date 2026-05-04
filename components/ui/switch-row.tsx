import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'

import { SwitchVisual } from '@/components/ui/switch-visual'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type SwitchRowProps = {
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: SwitchRowProps) {
  return (
    <Pressable
      role="switch"
      aria-checked={checked}
      aria-label={label}
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onCheckedChange(!checked)}
      className={cn(
        'flex-row items-center gap-3 rounded-md px-row-x-md py-row-y-md',
        'active:bg-tint-press',
        Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
        disabled && 'opacity-50',
        Platform.select({ web: disabled && 'cursor-not-allowed' }),
        className,
      )}
    >
      <View className="flex-1 gap-0.5">
        <Text className="font-medium">{label}</Text>
        {hint != null ? (
          <Text variant="muted" size="sm">
            {hint}
          </Text>
        ) : null}
      </View>
      <SwitchVisual checked={checked} disabled={disabled} />
    </Pressable>
  )
}

export type { SwitchRowProps }
