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
}

/**
 * A chip lights only on an exact preset match — a continuous value shows none lit. `NumberInput`
 * reports `null` for unreadable text too, saving as "not recorded" while the invalid border shows.
 */
export function DecayResistanceField({
  value,
  onChange,
  label,
  disabled,
  disabledReason,
  invalid,
}: DecayResistanceFieldProps) {
  return (
    <View className="gap-2">
      {/* Named — a bare chip-row label is ambiguous with multiple decay fields on one card. */}
      <View role="group" aria-label={label} className="flex-row flex-wrap gap-2">
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
        className="w-28"
      />
    </View>
  )
}

export type { DecayResistanceFieldProps }
