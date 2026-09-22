import { View } from 'react-native'

import { NumberInput } from '@/components/compounds/number-input'
import { Chip } from '@/components/ui/chip'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

const PRESETS = [
  { id: 'low', value: 0.2 },
  { id: 'medium', value: 0.5 },
  { id: 'high', value: 0.8 },
] as const

type DecayResistanceFieldProps = {
  value: number | null
  onChange: (value: number | null) => void
  label: string
  disabled?: boolean
  disabledReason?: string
  /** From the owning Controller's `fieldState.invalid` — out of the 0..1 draft range. */
  invalid?: boolean
  testID?: string
}

/**
 * A chip lights only on an exact match, so a continuous classifier value (severity clamped
 * to 0..1) displays with none lit. Unreadable text reports `null` from `NumberInput`, same as
 * empty — it saves as "not recorded" while the field still shows the invalid border.
 */
export function DecayResistanceField({
  value,
  onChange,
  label,
  disabled,
  disabledReason,
  invalid,
  testID,
}: DecayResistanceFieldProps) {
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            selected={value === preset.value}
            disabled={disabled}
            onPress={() => onChange(preset.value)}
          >
            <Text size="xs">{t(`plot:fields.decayPreset.${preset.id}`)}</Text>
          </Chip>
        ))}
      </View>
      <NumberInput
        value={value}
        onChange={onChange}
        label={label}
        integer={false}
        disabled={disabled}
        disabledReason={disabledReason}
        invalid={invalid}
        testID={testID}
        className="w-28"
      />
    </View>
  )
}

export type { DecayResistanceFieldProps }
