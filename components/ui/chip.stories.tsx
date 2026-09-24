import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import { themes } from '@/lib/themes'

import { Chip } from './chip'
import { Text } from './text'

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
  play: async () => {
    // NativeWind upgrades a `group` View to a Pressable, which swallows a parent row's tap.
    await expect(screen.getByText('read-only').parentElement).not.toHaveClass('group')
  },
}

export const FilterRow: Story = {
  render: () => {
    const [active, setActive] = useState('all')
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
  play: async () => {
    await expect(screen.getByText('Staged').parentElement).toHaveClass('group')
  },
}

export const Disabled: Story = {
  render: () => (
    <View className="flex-row gap-2">
      <Chip disabled disabledReason="A run is in progress." onPress={() => {}}>
        Disabled, off
      </Chip>
      <Chip disabled selected onPress={() => {}}>
        Disabled, on
      </Chip>
    </View>
  ),
  play: async () => {
    const chip = screen.getByRole('button', { name: 'Disabled, off' })
    await expect(chip.closest('[title]')).toHaveAttribute('title', 'A run is in progress.')
  },
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
