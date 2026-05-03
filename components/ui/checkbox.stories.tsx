import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Checkbox } from './checkbox'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Checkbox> = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    checked: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Checkbox>

const noop = () => {}

export const Default: Story = {
  args: { checked: false, onCheckedChange: noop },
}

export const Controlled: Story = {
  render: () => {
    const [checked, setChecked] = React.useState(false)
    return (
      <View className="flex-row items-center gap-3">
        <Checkbox checked={checked} onCheckedChange={setChecked} />
        <Text>{checked ? 'Checked' : 'Unchecked'}</Text>
      </View>
    )
  },
}

export const States: Story = {
  render: () => (
    <View className="flex-col gap-3">
      <View className="flex-row items-center gap-3">
        <Checkbox checked={false} onCheckedChange={noop} />
        <Text>Unchecked</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Checkbox checked={true} onCheckedChange={noop} />
        <Text>Checked</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Checkbox checked={false} disabled onCheckedChange={noop} />
        <Text>Disabled (unchecked)</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Checkbox checked={true} disabled onCheckedChange={noop} />
        <Text>Disabled (checked)</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Checkbox checked={false} aria-invalid onCheckedChange={noop} />
        <Text>Error (aria-invalid)</Text>
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
            <Checkbox checked={false} onCheckedChange={noop} />
            <Checkbox checked={true} onCheckedChange={noop} />
            <Checkbox checked={false} disabled onCheckedChange={noop} />
            <Checkbox checked={true} disabled onCheckedChange={noop} />
            <Checkbox checked={false} aria-invalid onCheckedChange={noop} />
          </View>
        </View>
      ))}
    </View>
  ),
}
