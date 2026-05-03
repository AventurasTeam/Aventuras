import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Switch } from './switch'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Switch> = {
  title: 'Primitives/Switch',
  component: Switch,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    checked: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Switch>

const noop = () => {}

export const Default: Story = {
  args: { checked: false, onCheckedChange: noop },
}

export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = React.useState(false)
    return (
      <View className="flex-row items-center gap-3">
        <Switch checked={checked} onCheckedChange={setChecked} />
        <Text>{checked ? 'On' : 'Off'}</Text>
      </View>
    )
  },
}

export const States: Story = {
  render: () => (
    <View className="flex-col gap-3">
      <View className="flex-row items-center gap-3">
        <Switch checked={false} onCheckedChange={noop} />
        <Text>Off</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Switch checked={true} onCheckedChange={noop} />
        <Text>On</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Switch checked={false} disabled onCheckedChange={noop} />
        <Text>Disabled (off)</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Switch checked={true} disabled onCheckedChange={noop} />
        <Text>Disabled (on)</Text>
      </View>
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
          <View className="flex-row items-center gap-3">
            <Switch checked={false} onCheckedChange={noop} />
            <Switch checked={true} onCheckedChange={noop} />
            <Switch checked={false} disabled onCheckedChange={noop} />
            <Switch checked={true} disabled onCheckedChange={noop} />
          </View>
        </View>
      ))}
    </View>
  ),
}
