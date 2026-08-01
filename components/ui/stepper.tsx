import { Minus, Plus } from 'lucide-react-native'
import { View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type StepperProps = {
  value: number
  /** Inclusive. Decrement is disabled at or below this value. */
  min: number
  /** Inclusive. Increment is disabled at or above this value. */
  max: number
  /** Never fires outside `[min, max]`, given a finite `value` and `min <= max`. */
  onChange: (next: number) => void
  /** Translated accessible name for the value. Pair with the visible field label. */
  label: string
  /** Translated accessible name for the decrement control. */
  decrementLabel: string
  /** Translated accessible name for the increment control. */
  incrementLabel: string
  disabled?: boolean
  testID?: string
  className?: string
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  decrementLabel,
  incrementLabel,
  disabled,
  testID,
  className,
}: StepperProps) {
  // Each gate blocks only the step that moves further out, so a `value` arriving
  // outside `[min, max]` can still step to another out-of-range one.
  const clamp = (next: number) => Math.min(max, Math.max(min, next))
  return (
    <View
      testID={testID}
      accessibilityRole="spinbutton"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      accessibilityState={{ disabled: disabled === true }}
      className={cn('flex-row items-center gap-2', className)}
    >
      <IconAction
        icon={Minus}
        label={decrementLabel}
        size="sm"
        disabled={disabled || value <= min}
        onPress={() => onChange(clamp(value - 1))}
      />
      <Text className="min-w-6 text-center">{String(value)}</Text>
      <IconAction
        icon={Plus}
        label={incrementLabel}
        size="sm"
        disabled={disabled || value >= max}
        onPress={() => onChange(clamp(value + 1))}
      />
    </View>
  )
}

export type { StepperProps }
