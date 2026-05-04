// Select stories — Default · Variants · Sizes · States · ThemeMatrix
// (partial). ThemeMatrix is intentionally partial per the
// portal-skip rule in docs/ui/components.md → Storybook story
// conventions: the dropdown render mode portals its open content
// to document.body, escaping per-row dataSet scoping. Theme
// verification for the dropdown branch happens via the toolbar
// global theme switcher (web) or `<ThemePicker />` on the dev page
// (native). Segment and radio render modes stay inline so they ARE
// covered in ThemeMatrix below.
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Select, type SelectOption } from './select'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Select> = {
  title: 'Primitives/Select',
  component: Select,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Select>

const SHORT_OPTIONS: SelectOption[] = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
  { value: 'three', label: 'Three' },
]

const LONG_OPTIONS: SelectOption[] = Array.from({ length: 8 }, (_, i) => ({
  value: `opt-${i + 1}`,
  label: `Option ${i + 1}`,
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
  ...rest
}: {
  initial: string
  options: SelectOption[]
  mode?: React.ComponentProps<typeof Select>['mode']
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const [value, setValue] = React.useState(initial)
  return <Select {...rest} value={value} onValueChange={setValue} />
}

export const Default: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial="two" options={SHORT_OPTIONS} />
    </View>
  ),
}

export const Variants: Story = {
  render: () => (
    <View className="flex-col gap-6 p-4">
      <View className="flex-col gap-2">
        <Text variant="muted" size="xs">
          segment (cardinality ≤ 3 / ≤ 2 on phone)
        </Text>
        <Stateful initial="two" mode="segment" options={SHORT_OPTIONS} />
      </View>
      <View className="flex-col gap-2">
        <Text variant="muted" size="xs">
          radio (any option carries a description)
        </Text>
        <Stateful initial="collaborate" mode="radio" options={RADIO_OPTIONS} />
      </View>
      <View className="w-72 flex-col gap-2">
        <Text variant="muted" size="xs">
          dropdown (≥ 4 options or `mode=&quot;dropdown&quot;` explicit)
        </Text>
        <Stateful initial="opt-1" mode="dropdown" options={LONG_OPTIONS} />
      </View>
    </View>
  ),
}

export const States: Story = {
  render: () => (
    <View className="flex-col gap-4 p-4">
      <View className="flex-col gap-2">
        <Text variant="muted" size="xs">
          empty (no value yet)
        </Text>
        <View className="w-72">
          <Stateful initial="" mode="dropdown" options={LONG_OPTIONS} placeholder="Pick one…" />
        </View>
      </View>
      <View className="flex-col gap-2">
        <Text variant="muted" size="xs">
          disabled (whole control)
        </Text>
        <View className="w-72">
          <Stateful initial="opt-1" mode="dropdown" options={LONG_OPTIONS} disabled />
        </View>
      </View>
      <View className="flex-col gap-2">
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
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-6">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col gap-3 rounded-md bg-bg-base p-4"
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="flex-col gap-3">
            <Stateful initial="two" mode="segment" options={SHORT_OPTIONS} />
            <Stateful initial="collaborate" mode="radio" options={RADIO_OPTIONS} />
            {/* Dropdown trigger only — open content portals to
                document.body and escapes the per-row dataSet scope.
                The trigger itself IS scoped, so border + hover
                contrast across themes can be validated here. The
                open-popover content theming is verified via the
                Storybook toolbar theme switcher instead. */}
            <Stateful initial="opt-3" mode="dropdown" options={LONG_OPTIONS} />
          </View>
        </View>
      ))}
    </View>
  ),
}
