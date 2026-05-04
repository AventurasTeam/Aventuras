import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { Eye, EyeOff, Search } from 'lucide-react-native'
import * as React from 'react'
import { Pressable, View } from 'react-native'

import { Icon } from './icon'
import { Input } from './input'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Input> = {
  title: 'Primitives/Input',
  component: Input,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    editable: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: { placeholder: 'Type something…' },
  render: (args) => (
    <View style={{ width: 320 }}>
      <Input {...args} />
    </View>
  ),
}

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = React.useState('')
    return (
      <View style={{ width: 320 }} className="gap-2">
        <Input value={value} onChangeText={setValue} placeholder="Controlled input" />
        <Text variant="muted" size="sm">
          Value: {value || '<empty>'}
        </Text>
      </View>
    )
  },
}

export const Sizes: Story = {
  render: () => (
    <View style={{ width: 320 }} className="gap-3">
      <Input size="sm" placeholder="Small" />
      <Input size="md" placeholder="Medium (default)" />
      <Input size="lg" placeholder="Large" />
    </View>
  ),
}

export const States: Story = {
  render: () => (
    <View style={{ width: 320 }} className="gap-3">
      <Input placeholder="Default" />
      <Input editable={false} value="Disabled" />
      <Input aria-invalid value="invalid@" placeholder="Error (aria-invalid)" />
    </View>
  ),
}

export const NumericNarrow: Story = {
  render: () => (
    <View className="flex-row items-center gap-2">
      <Text>Year:</Text>
      <Input keyboardType="numeric" defaultValue="2024" className="w-24" />
    </View>
  ),
}

export const AdornmentLeading: Story = {
  render: () => (
    <View style={{ width: 320 }}>
      <Input
        placeholder="Search…"
        leading={<Icon as={Search} size="sm" className="text-fg-muted" />}
      />
    </View>
  ),
}

export const AdornmentTrailing: Story = {
  render: () => {
    const [secure, setSecure] = React.useState(true)
    return (
      <View style={{ width: 320 }}>
        <Input
          placeholder="API key"
          secureTextEntry={secure}
          defaultValue="sk-or-v1-abcdef0123"
          trailing={
            <Pressable
              onPress={() => setSecure((s) => !s)}
              accessibilityLabel={secure ? 'Show value' : 'Hide value'}
            >
              <Icon as={secure ? EyeOff : Eye} size="sm" className="text-fg-muted" />
            </Pressable>
          }
        />
      </View>
    )
  },
}

export const AdornmentBoth: Story = {
  render: () => (
    <View style={{ width: 320 }}>
      <Input
        placeholder="Search fields…"
        leading={<Icon as={Search} size="sm" className="text-fg-muted" />}
        trailing={
          <Pressable accessibilityLabel="Search syntax help">
            <Text size="sm" variant="muted">
              ?
            </Text>
          </Pressable>
        }
      />
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
          className="gap-2 rounded-md bg-bg-base p-4"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <Input placeholder="Default" />
          <Input
            placeholder="Search…"
            leading={<Icon as={Search} size="sm" className="text-fg-muted" />}
          />
          <Input aria-invalid value="invalid@" />
        </View>
      ))}
    </View>
  ),
}
