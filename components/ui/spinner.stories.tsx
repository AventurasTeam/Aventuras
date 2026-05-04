import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Spinner } from './spinner'
import { Text } from './text'
import { Button } from './button'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Spinner> = {
  title: 'Primitives/Spinner',
  component: Spinner,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    size: { control: { type: 'select' }, options: ['sm', 'md', 'lg'] },
    colorSlot: {
      control: { type: 'select' },
      options: ['--fg-primary', '--fg-muted', '--accent', '--danger', '--success'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Spinner>

export const Default: Story = {
  args: { size: 'md' },
}

export const Sizes: Story = {
  render: () => (
    <View className="flex-row items-end gap-6">
      <View className="items-center gap-1">
        <Spinner size="sm" />
        <Text variant="muted" size="sm">
          sm
        </Text>
      </View>
      <View className="items-center gap-1">
        <Spinner size="md" />
        <Text variant="muted" size="sm">
          md
        </Text>
      </View>
      <View className="items-center gap-1">
        <Spinner size="lg" />
        <Text variant="muted" size="sm">
          lg
        </Text>
      </View>
    </View>
  ),
}

export const ColorSlots: Story = {
  render: () => (
    <View className="flex-row items-center gap-6">
      <Spinner colorSlot="--fg-primary" />
      <Spinner colorSlot="--fg-muted" />
      <Spinner colorSlot="--accent" />
      <Spinner colorSlot="--danger" />
      <Spinner colorSlot="--success" />
    </View>
  ),
}

export const InsideButton: Story = {
  render: () => (
    <View className="gap-3">
      <Button loading variant="primary">
        <Text>Primary</Text>
      </Button>
      <Button loading variant="secondary">
        <Text>Secondary</Text>
      </Button>
      <Button loading variant="ghost">
        <Text>Ghost</Text>
      </Button>
      <Button loading variant="destructive">
        <Text>Destructive</Text>
      </Button>
    </View>
  ),
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
          <View className="flex-row items-center gap-4">
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
            <Spinner colorSlot="--accent" />
            <Spinner colorSlot="--danger" />
          </View>
        </View>
      ))}
    </View>
  ),
}
