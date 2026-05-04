import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Chip } from './chip'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Chip> = {
  title: 'Primitives/Chip',
  component: Chip,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Chip>

export const Static: Story = {
  render: () => (
    <View className="flex-row gap-2">
      <Chip>read-only</Chip>
      <Chip selected>active state</Chip>
    </View>
  ),
}

export const FilterRow: Story = {
  render: () => {
    const [active, setActive] = React.useState('all')
    const filters = ['all', 'in-scene', 'active', 'staged', 'retired']
    return (
      <View className="flex-row gap-2">
        {filters.map((f) => (
          <Chip key={f} selected={active === f} onPress={() => setActive(f)}>
            {f === 'in-scene' ? 'In scene' : f.charAt(0).toUpperCase() + f.slice(1)}
          </Chip>
        ))}
      </View>
    )
  },
}

export const Disabled: Story = {
  render: () => (
    <View className="flex-row gap-2">
      <Chip disabled onPress={() => {}}>
        Disabled, off
      </Chip>
      <Chip disabled selected onPress={() => {}}>
        Disabled, on
      </Chip>
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-3"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <View className="flex-row gap-2">
            <Chip selected onPress={() => {}}>
              All
            </Chip>
            <Chip onPress={() => {}}>Active</Chip>
            <Chip onPress={() => {}}>Staged</Chip>
            <Chip onPress={() => {}}>Retired</Chip>
          </View>
        </View>
      ))}
    </View>
  ),
}
