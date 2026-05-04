import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { Flag, MapPin, Package, User } from 'lucide-react-native'
import * as React from 'react'
import { View } from 'react-native'

import { Avatar } from './avatar'
import { Icon } from './icon'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Avatar> = {
  title: 'Primitives/Avatar',
  component: Avatar,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    size: { control: { type: 'select' }, options: ['xs', 'sm', 'md', 'lg'] },
  },
}

export default meta
type Story = StoryObj<typeof Avatar>

const SAMPLE_IMAGE = 'https://i.pravatar.cc/300'

export const Default: Story = {
  args: { size: 'sm', alt: 'Daisy', fallback: 'DV' },
}

export const WithImage: Story = {
  args: { size: 'md', alt: 'Daisy', src: SAMPLE_IMAGE, fallback: 'DV' },
}

export const Sizes: Story = {
  render: () => (
    <View className="flex-row items-end gap-4">
      <View className="items-center gap-1">
        <Avatar size="xs" alt="xs" fallback="X" />
        <Text variant="muted" size="sm">
          xs · 24
        </Text>
      </View>
      <View className="items-center gap-1">
        <Avatar size="sm" alt="sm" fallback="SM" />
        <Text variant="muted" size="sm">
          sm · 40
        </Text>
      </View>
      <View className="items-center gap-1">
        <Avatar size="md" alt="md" fallback="MD" />
        <Text variant="muted" size="sm">
          md · 96
        </Text>
      </View>
      <View className="items-center gap-1">
        <Avatar size="lg" alt="lg" fallback="LG" />
        <Text variant="muted" size="sm">
          lg · 220
        </Text>
      </View>
    </View>
  ),
}

export const FallbackText: Story = {
  render: () => (
    <View className="flex-row items-center gap-4">
      <Avatar size="xs" alt="Daisy V." fallback="DV" />
      <Avatar size="sm" alt="Daisy V." fallback="DV" />
      <Avatar size="md" alt="Daisy V." fallback="DV" />
      <Avatar size="lg" alt="Daisy V." fallback="DV" />
    </View>
  ),
}

export const FallbackIcon: Story = {
  render: () => (
    <View className="flex-col gap-3">
      <Text variant="muted" size="sm">
        Entity-kind glyphs as fallback
      </Text>
      <View className="flex-row items-center gap-4">
        <View className="items-center gap-1">
          <Avatar size="sm" alt="Character" fallback={<Icon as={User} size="md" />} />
          <Text size="sm">character</Text>
        </View>
        <View className="items-center gap-1">
          <Avatar size="sm" alt="Location" fallback={<Icon as={MapPin} size="md" />} />
          <Text size="sm">location</Text>
        </View>
        <View className="items-center gap-1">
          <Avatar size="sm" alt="Item" fallback={<Icon as={Package} size="md" />} />
          <Text size="sm">item</Text>
        </View>
        <View className="items-center gap-1">
          <Avatar size="sm" alt="Faction" fallback={<Icon as={Flag} size="md" />} />
          <Text size="sm">faction</Text>
        </View>
      </View>
    </View>
  ),
}

export const Empty: Story = {
  args: { size: 'sm', alt: 'No fallback' },
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="flex-col gap-2 rounded-md bg-bg-base p-4"
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="flex-row items-center gap-3">
            <Avatar size="xs" alt="Daisy" fallback="DV" />
            <Avatar size="sm" alt="Daisy" fallback="DV" />
            <Avatar size="sm" alt="Character" fallback={<Icon as={User} size="md" />} />
            <Avatar size="sm" alt="Location" fallback={<Icon as={MapPin} size="md" />} />
          </View>
        </View>
      ))}
    </View>
  ),
}
