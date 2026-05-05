import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { DensityPicker } from '@/components/foundations/sections/density-picker'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'

const SHORT_OPTIONS: SelectOption[] = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
  { value: 'three', label: 'Three' },
]

const LONG_OPTIONS: SelectOption[] = Array.from({ length: 8 }, (_, i) => ({
  value: `opt-${i + 1}`,
  label: `Option ${i + 1}`,
}))

const RICH_OPTIONS: SelectOption[] = Array.from({ length: 12 }, (_, i) => ({
  value: `model-${i + 1}`,
  label: `Model ${i + 1}`,
  group: i < 6 ? 'Featured' : 'All models',
}))

const RADIO_OPTIONS: SelectOption[] = [
  {
    value: 'collaborate',
    label: 'Collaborate',
    description: 'Co-author entries with the AI; suggestions surface inline.',
  },
  {
    value: 'review',
    label: 'Review',
    description: 'AI drafts; you accept, edit, or reject before commit.',
  },
  {
    value: 'narrate',
    label: 'Narrate',
    description: 'AI narrates the world; you respond as the protagonist.',
  },
]

function Stateful({
  initial,
  options,
  ...rest
}: {
  initial: string
  options: SelectOption[]
  mode?: React.ComponentProps<typeof Select>['mode']
  sheetSize?: React.ComponentProps<typeof Select>['sheetSize']
  placeholder?: string
  label?: string
  disabled?: boolean
  className?: string
}) {
  const [value, setValue] = React.useState(initial)
  return <Select options={options} value={value} onValueChange={setValue} {...rest} />
}

export default function SelectDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <DensityPicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Default — auto-derive cascade</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Three options on phone (≤ 2) routes to dropdown; on tablet/desktop (≤ 3) routes to
            segment. Cardinality threshold reads `useTier()`.
          </Text>
          <View className="mt-3">
            <Stateful initial="two" options={SHORT_OPTIONS} />
          </View>
        </View>

        <View>
          <Heading level={3}>Variants — explicit mode</Heading>
          <View className="mt-3 flex-col gap-4">
            <View className="flex-col gap-1">
              <Text variant="muted" size="xs">
                segment
              </Text>
              <Stateful initial="two" mode="segment" options={SHORT_OPTIONS} />
            </View>
            <View className="flex-col gap-1">
              <Text variant="muted" size="xs">
                radio
              </Text>
              <Stateful initial="collaborate" mode="radio" options={RADIO_OPTIONS} />
            </View>
            <View className="flex-col gap-1">
              <Text variant="muted" size="xs">
                dropdown — flat list (auto Sheet short on phone)
              </Text>
              <Stateful
                initial="opt-1"
                mode="dropdown"
                options={LONG_OPTIONS}
                label="Pick option"
              />
            </View>
            <View className="flex-col gap-1">
              <Text variant="muted" size="xs">
                dropdown — grouped (auto Sheet medium on phone)
              </Text>
              <Stateful initial="model-1" mode="dropdown" options={RICH_OPTIONS} />
            </View>
          </View>
        </View>

        <View>
          <Heading level={3}>States</Heading>
          <View className="mt-3 flex-col gap-3">
            <View className="flex-col gap-1">
              <Text variant="muted" size="xs">
                empty (no value)
              </Text>
              <Stateful initial="" mode="dropdown" options={LONG_OPTIONS} placeholder="Pick one…" />
            </View>
            <View className="flex-col gap-1">
              <Text variant="muted" size="xs">
                disabled (whole control)
              </Text>
              <Stateful initial="opt-1" mode="dropdown" options={LONG_OPTIONS} disabled />
            </View>
            <View className="flex-col gap-1">
              <Text variant="muted" size="xs">
                per-option disabled (segment)
              </Text>
              <Stateful
                initial="one"
                mode="segment"
                options={[
                  { value: 'one', label: 'One' },
                  { value: 'two', label: 'Two', disabled: true },
                  { value: 'three', label: 'Three' },
                ]}
              />
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
