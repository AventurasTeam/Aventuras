import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, userEvent } from 'storybook/test'

import { Input } from './input'

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="w-80">
        <Story />
      </View>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: {
    placeholder: 'you@example.com',
  },
}

export const WithValue: Story = {
  args: {
    value: 'hello@aventuras.app',
  },
}

export const Disabled: Story = {
  args: {
    placeholder: "can't touch this",
    editable: false,
  },
}

export const Invalid: Story = {
  args: {
    placeholder: 'broken input',
    'aria-invalid': true,
    value: 'not-an-email',
  } as Parameters<typeof Input>[0] & { 'aria-invalid'?: boolean },
}

export const TypingFlow: Story = {
  name: 'Typing flow (interactive)',
  args: {
    placeholder: 'type here',
    onChangeText: fn(),
  },
  render: (args) => {
    const [value, setValue] = useState('')
    return (
      <Input
        {...args}
        value={value}
        onChangeText={(v) => {
          setValue(v)
          args.onChangeText?.(v)
        }}
      />
    )
  },
  play: async ({ canvas, args }) => {
    const input = await canvas.findByPlaceholderText('type here')
    await userEvent.type(input, 'aventuras')
    await expect(input).toHaveValue('aventuras')
    await expect(args.onChangeText).toHaveBeenCalled()
  },
}
