// MultiSelect stories — Basic · Partial · None · Disabled · PerOptionDisabled
// · NarrowContainer · ThemeMatrix (partial). ThemeMatrix is partial per the
// portal-skip rule in docs/ui/components.md → Storybook story conventions:
// the open overlay portals to document.body, escaping per-row dataSet
// scoping. Theme verification for the open branch uses the toolbar global
// theme switcher (web) or <ThemePicker /> on the dev page (native).
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'

import { themes } from '@/lib/themes'

import { MultiSelect } from './multi-select'
import { type MultiSelectOption } from './multi-select-state'
import { Text } from './text'

const meta: Meta<typeof MultiSelect> = {
  title: 'Primitives/MultiSelect',
  component: MultiSelect,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof MultiSelect>

const OPTIONS: MultiSelectOption[] = [
  { value: 'classifier' },
  { value: 'retrieval' },
  { value: 'provider' },
  { value: 'embedder' },
  { value: 'pipeline' },
  { value: 'lore_mgmt', label: 'lore mgmt' },
  { value: 'translation' },
  { value: 'chapter_close', label: 'chapter close' },
]

function Stateful({
  initial,
  options = OPTIONS,
  prefix = 'Subsystem',
  disabled,
}: {
  initial: string[]
  options?: MultiSelectOption[]
  prefix?: string
  disabled?: boolean
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  return (
    <MultiSelect
      prefix={prefix}
      options={options}
      selected={selected}
      onChange={setSelected}
      disabled={disabled}
    />
  )
}

export const Basic: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial={OPTIONS.map((o) => o.value)} />
    </View>
  ),
}

export const Partial: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial={['classifier', 'retrieval', 'provider', 'embedder']} />
    </View>
  ),
}

export const None: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial={[]} />
    </View>
  ),
}

export const Disabled: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial={['classifier']} disabled />
    </View>
  ),
}

export const PerOptionDisabled: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful
        initial={['classifier', 'retrieval']}
        options={[
          { value: 'classifier' },
          { value: 'retrieval' },
          { value: 'provider', disabled: true, label: 'provider (gated)' },
          { value: 'embedder' },
        ]}
      />
    </View>
  ),
}

export const NarrowContainer: Story = {
  render: () => (
    <View className="w-40 p-4">
      <Stateful initial={['classifier', 'retrieval']} prefix="Source" />
    </View>
  ),
}

export const ThemeMatrix: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Trigger-state matrix (closed). Open the overlay via the toolbar theme switcher to verify open-state tones.',
      },
    },
  },
  render: () => (
    <View className="flex-row flex-wrap gap-6 p-6">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col items-start gap-2 rounded-md border border-border bg-bg-base p-4"
        >
          <Text size="xs" variant="muted">
            {t.name}
          </Text>
          <Stateful initial={['classifier', 'retrieval']} />
        </View>
      ))}
    </View>
  ),
}
