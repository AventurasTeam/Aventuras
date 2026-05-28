import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { DensityPicker } from '@/components/foundations/sections/density-picker'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { MultiSelect } from '@/components/ui/multi-select'
import { type MultiSelectOption } from '@/components/ui/multi-select-state'
import { Text } from '@/components/ui/text'

const SUBSYSTEMS: MultiSelectOption[] = [
  { value: 'classifier' },
  { value: 'retrieval' },
  { value: 'provider' },
  { value: 'embedder' },
  { value: 'pipeline' },
  { value: 'lore_mgmt', label: 'lore mgmt' },
  { value: 'translation' },
  { value: 'chapter_close', label: 'chapter close' },
]

const WITH_DISABLED: MultiSelectOption[] = [
  { value: 'classifier' },
  { value: 'retrieval' },
  { value: 'provider', disabled: true, label: 'provider (gated)' },
  { value: 'embedder' },
]

function Stateful({
  initial,
  options = SUBSYSTEMS,
  prefix = 'Subsystem',
  disabled,
  disabledReason,
}: {
  initial: string[]
  options?: MultiSelectOption[]
  prefix?: string
  disabled?: boolean
  disabledReason?: string
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  return (
    <View className="gap-2">
      <MultiSelect
        prefix={prefix}
        options={options}
        selected={selected}
        onChange={setSelected}
        disabled={disabled}
        disabledReason={disabledReason}
      />
      <Text variant="muted" size="xs">
        {selected.length === 0 ? '(none selected)' : `selected: ${selected.join(', ')}`}
      </Text>
    </View>
  )
}

export default function MultiSelectDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <DensityPicker />
      <View className="flex-col gap-8 p-4">
        <View className="gap-2">
          <Heading level={2}>MultiSelect — basic</Heading>
          <Text size="sm" variant="muted">
            All-selected default. Trigger reads `Subsystem: all ▾`. Open via tap; toggle rows; use
            Select all / Clear all in the overlay header. On phone (native), overlay swaps to a
            medium Sheet anchored to the bottom — the touch floor is enforced at 44 px per row.
          </Text>
          <Stateful initial={SUBSYSTEMS.map((o) => o.value)} />
        </View>

        <View className="gap-2">
          <Heading level={2}>Partial selection (`N of M`)</Heading>
          <Text size="sm" variant="muted">
            Both Select all and Clear all enabled. Trigger reads `Subsystem: 4 of 8 ▾`.
          </Text>
          <Stateful initial={['classifier', 'retrieval', 'provider', 'embedder']} />
        </View>

        <View className="gap-2">
          <Heading level={2}>None selected</Heading>
          <Text size="sm" variant="muted">
            Select all enabled, Clear all disabled. Trigger reads `Subsystem: none ▾`.
          </Text>
          <Stateful initial={[]} />
        </View>

        <View className="gap-2">
          <Heading level={2}>Whole-control disabled</Heading>
          <Text size="sm" variant="muted">
            Trigger at 50% opacity, taps do nothing. Hover on web shows the disabledReason tooltip.
          </Text>
          <Stateful
            initial={['classifier']}
            disabled
            disabledReason="No subsystem captures available — flip the master toggle to enable."
          />
        </View>

        <View className="gap-2">
          <Heading level={2}>Per-option disabled</Heading>
          <Text size="sm" variant="muted">
            Open the overlay — the `provider (gated)` row is at 50% opacity and rejects taps; other
            rows toggle normally.
          </Text>
          <Stateful initial={['classifier', 'retrieval']} options={WITH_DISABLED} />
        </View>

        <View className="gap-2">
          <Heading level={2}>Narrow container (160 px)</Heading>
          <Text size="sm" variant="muted">
            Trigger renders within the constrained container; overlay opens at 256 px (`w-64`)
            anchored to the trigger on tablet+; the Sheet on phone takes the full width regardless.
          </Text>
          <View className="w-40">
            <Stateful initial={['classifier', 'retrieval']} prefix="Source" />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Multiple side-by-side</Heading>
          <Text size="sm" variant="muted">
            Layout sanity-check for the Toolbar secondary cluster: three triggers in a row, each
            independent.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Stateful initial={['classifier', 'retrieval']} prefix="Source" />
            <Stateful initial={['classifier']} prefix="Target" />
            <Stateful initial={SUBSYSTEMS.map((o) => o.value)} prefix="Subsystem" />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
