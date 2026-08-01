import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, userEvent, waitFor } from 'storybook/test'

import { themes } from '@/lib/themes'

import { Button } from './button'
import { Text } from './text'

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

const BLOCKED_REASON = 'Generation in progress'

function BlockToggleDemo() {
  const [blocked, setBlocked] = useState(false)
  return (
    <View className="flex-col gap-3">
      <Button variant="secondary" onPress={() => setBlocked((prev) => !prev)}>
        <Text>Toggle</Text>
      </Button>
      <Button disabled={blocked} disabledReason={blocked ? BLOCKED_REASON : undefined}>
        <Text>Target</Text>
      </Button>
    </View>
  )
}

export const DisabledReasonSurvivesTheFlip: Story = {
  render: () => <BlockToggleDemo />,
  play: async ({ canvas }) => {
    const target = canvas.getByRole('button', { name: 'Target' })
    expect(target.parentElement?.getAttribute('title')).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: 'Toggle' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Target' })).toBeDisabled())

    // Same DOM node across the flip: a wrapper gated on the disabled state
    // changes the root element type, and React remounts the control.
    expect(canvas.getByRole('button', { name: 'Target' })).toBe(target)
    expect(target.parentElement?.getAttribute('title')).toBe(BLOCKED_REASON)

    // RN-Web drops a raw `title` on Pressable, so the tooltip can only sit on
    // an ancestor. Assert the browser's own hit test still reaches it — the
    // disabled control itself is `pointer-events: none`.
    const rect = target.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    expect(hit?.closest('[title]')?.getAttribute('title')).toBe(BLOCKED_REASON)
  },
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
        <View
          key={t.id}
          // RN-Web forwards `dataSet` to `data-*` attributes; RN's plain
          // `data-theme` prop is silently dropped. dataSet scopes each
          // row to its theme via the [data-theme="<id>"] CSS-var blocks
          // in global.css, overriding the global toolbar selection.
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col gap-2 rounded-md bg-bg-base p-4"
        >
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
