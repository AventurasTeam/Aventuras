import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Text } from './text'
import { Textarea } from './textarea'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Textarea> = {
  title: 'Primitives/Textarea',
  component: Textarea,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    rows: { control: { type: 'number', min: 1, max: 20 } },
    maxRows: { control: { type: 'number', min: 1, max: 30 } },
    editable: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Textarea>

export const Default: Story = {
  args: { placeholder: 'Multi-line text…', rows: 3, maxRows: 10 },
  render: (args) => (
    <View style={{ width: 360 }}>
      <Textarea {...args} />
    </View>
  ),
}

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = React.useState('')
    return (
      <View style={{ width: 360 }} className="gap-2">
        <Textarea
          value={value}
          onChangeText={setValue}
          placeholder="Controlled textarea"
          rows={4}
        />
        <Text variant="muted" size="sm">
          Length: {value.length}
        </Text>
      </View>
    )
  },
}

export const Rows: Story = {
  render: () => (
    <View style={{ width: 360 }} className="gap-3">
      <View className="gap-1">
        <Text size="sm" variant="muted">
          rows={3}
        </Text>
        <Textarea rows={3} placeholder="3 rows" />
      </View>
      <View className="gap-1">
        <Text size="sm" variant="muted">
          rows={5}
        </Text>
        <Textarea rows={5} placeholder="5 rows" />
      </View>
      <View className="gap-1">
        <Text size="sm" variant="muted">
          rows={10}
        </Text>
        <Textarea rows={10} placeholder="10 rows" />
      </View>
    </View>
  ),
}

export const States: Story = {
  render: () => (
    <View style={{ width: 360 }} className="gap-3">
      <Textarea placeholder="Default" />
      <Textarea editable={false} value="Disabled — non-editable content" />
      <Textarea aria-invalid value="" placeholder="Error (aria-invalid)" />
    </View>
  ),
}

export const AutoGrow: Story = {
  render: () => {
    const [value, setValue] = React.useState(
      'Short start.\nType more lines and watch the textarea grow up to maxRows={6}.\n',
    )
    return (
      <View style={{ width: 360 }} className="gap-2">
        <Textarea
          value={value}
          onChangeText={setValue}
          rows={2}
          maxRows={6}
          placeholder="Grows from rows=2 up to maxRows=6"
        />
        <Text variant="muted" size="sm">
          Web: field-sizing-content. Native: onContentSizeChange clamped to envelope.
        </Text>
      </View>
    )
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
          className="gap-2 rounded-md bg-bg-base p-4"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <Textarea placeholder="Default" rows={3} />
          <Textarea aria-invalid value="" placeholder="Invalid" rows={3} />
        </View>
      ))}
    </View>
  ),
}
