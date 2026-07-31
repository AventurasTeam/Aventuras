import { Minus, Plus } from 'lucide-react-native'
import { View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type StepperProps = {
  value: number
  /** Inclusive. Decrement is disabled at this value. */
  min: number
  /** Inclusive. Increment is disabled at this value. */
  max: number
  /** Never fires with a value outside `[min, max]`. */
  onChange: (next: number) => void
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
  decrementLabel,
  incrementLabel,
  disabled,
  testID,
  className,
}: StepperProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next))
  return (
    <View testID={testID} className={cn('flex-row items-center gap-2', className)}>
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
