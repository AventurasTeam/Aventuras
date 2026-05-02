import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Button } from './button'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'destructive'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Default: Story = {
  args: { variant: 'primary', size: 'md', children: <Text>Click me</Text> },
}

export const Variants: Story = {
  render: () => (
    <View className="flex-row flex-wrap gap-3">
      <Button variant="primary">
        <Text>Primary</Text>
      </Button>
      <Button variant="secondary">
        <Text>Secondary</Text>
      </Button>
      <Button variant="ghost">
        <Text>Ghost</Text>
      </Button>
      <Button variant="destructive">
        <Text>Destructive</Text>
      </Button>
    </View>
  ),
}

export const Sizes: Story = {
  render: () => (
    <View className="flex-row items-center gap-3">
      <Button size="sm">
        <Text>Small</Text>
      </Button>
      <Button size="md">
        <Text>Medium</Text>
      </Button>
      <Button size="lg">
        <Text>Large</Text>
      </Button>
      <Button size="icon" aria-label="Settings">
        <Text>⚙</Text>
      </Button>
    </View>
  ),
}

export const States: Story = {
  render: () => (
    <View className="flex-col gap-3">
      <Button>
        <Text>Idle</Text>
      </Button>
      <Button disabled>
        <Text>Disabled</Text>
      </Button>
      <Button loading>
        <Text>Loading</Text>
      </Button>
    </View>
  ),
}

export const Shapes: Story = {
  render: () => (
    <View className="flex-row gap-3">
      <Button>
        <Text>Text only</Text>
      </Button>
      <Button size="icon" aria-label="Settings">
        <Text>⚙</Text>
      </Button>
      <Button>
        <Text>⚙</Text>
        <Text>Icon + Text</Text>
      </Button>
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-6">
      {themes.map((t) => (
        <View key={t.id} data-theme={t.id} className="flex-col gap-2 rounded-md bg-bg-base p-4">
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="flex-row flex-wrap gap-3">
            <Button variant="primary">
              <Text>Primary</Text>
            </Button>
            <Button variant="secondary">
              <Text>Secondary</Text>
            </Button>
            <Button variant="ghost">
              <Text>Ghost</Text>
            </Button>
            <Button variant="destructive">
              <Text>Destructive</Text>
            </Button>
          </View>
        </View>
      ))}
    </View>
  ),
}
