import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { CalendarClock, GitBranch, Pencil, RotateCw, Trash2 } from 'lucide-react-native'
import { View } from 'react-native'
import { expect, fireEvent, fn, userEvent, waitFor } from 'storybook/test'

import { IconAction } from './icon-action'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof IconAction> = {
  title: 'Primitives/IconAction',
  component: IconAction,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    icon: { control: false },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    variant: { control: 'select', options: ['default', 'destructive'] },
    disabled: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof IconAction>

export const Default: Story = {
  args: { icon: Pencil, label: 'Edit', size: 'md', variant: 'default' },
}

export const Variants: Story = {
  render: () => (
    <View className="flex-row items-center gap-3">
      <IconAction icon={Pencil} label="Edit" />
      <IconAction icon={Trash2} label="Delete" variant="destructive" />
    </View>
  ),
}

export const Sizes: Story = {
  render: () => (
    <View className="flex-row items-center gap-3">
      <IconAction icon={Pencil} label="Edit" size="sm" />
      <IconAction icon={Pencil} label="Edit" size="md" />
      <IconAction icon={Pencil} label="Edit" size="lg" />
    </View>
  ),
}

/**
 * IconAction is designed for row contexts: muted by default, brightens
 * to full opacity on row (`group`) hover. This story wraps the icons
 * in a `group`-classed row so hovering anywhere in the row brightens
 * all icons together, matching the per-entry-actions pattern.
 */
export const InRowContext: Story = {
  render: () => (
    <View className="group w-96 flex-row items-center justify-between gap-3 rounded-md border border-border bg-bg-base px-4 py-3">
      <Text>Entry: a brave choice was made…</Text>
      <View className="flex-row items-center gap-1">
        <IconAction icon={Pencil} label="Edit entry" />
        <IconAction icon={RotateCw} label="Regenerate entry" />
        <IconAction icon={GitBranch} label="Branch from entry" />
        <IconAction icon={CalendarClock} label="Flip era from entry" />
        <IconAction icon={Trash2} label="Delete entry" variant="destructive" />
      </View>
    </View>
  ),
}

export const States: Story = {
  render: () => (
    <View className="flex-col gap-3">
      <View className="group flex-row items-center gap-3">
        <Text variant="muted" size="sm">
          Idle (hover row → brightens)
        </Text>
        <IconAction icon={Pencil} label="Edit" />
      </View>
      <View className="group flex-row items-center gap-3">
        <Text variant="muted" size="sm">
          Disabled with reason
        </Text>
        <IconAction
          icon={GitBranch}
          label="Branch from entry"
          disabled
          disabledReason="Generation in progress — branching available once complete"
        />
      </View>
      <View className="group flex-row items-center gap-3">
        <Text variant="muted" size="sm">
          Disabled, no reason
        </Text>
        <IconAction icon={Trash2} label="Delete" variant="destructive" disabled />
      </View>
    </View>
  ),
}

export const Density: Story = {
  render: () => (
    <View className="flex-col gap-6">
      {(['compact', 'regular', 'comfortable'] as const).map((d) => (
        <View
          key={d}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ density: d }}
          className="flex-col gap-2 rounded-md bg-bg-base p-4"
        >
          <Text variant="muted" size="sm">
            {d}
          </Text>
          <View className="group flex-row items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <Text size="sm">Sample row</Text>
            <View className="flex-row items-center gap-1">
              <IconAction icon={Pencil} label="Edit (sm)" size="sm" />
              <IconAction icon={RotateCw} label="Regen (md)" size="md" />
              <IconAction icon={GitBranch} label="Branch (lg)" size="lg" />
              <IconAction icon={Trash2} label="Delete (md destructive)" variant="destructive" />
            </View>
          </View>
        </View>
      ))}
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-6">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col gap-2 rounded-md bg-bg-base p-4"
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="group flex-row items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <Text size="sm">Sample row</Text>
            <View className="flex-row items-center gap-1">
              <IconAction icon={Pencil} label="Edit" />
              <IconAction icon={RotateCw} label="Regenerate" />
              <IconAction icon={GitBranch} label="Branch" />
              <IconAction icon={Trash2} label="Delete" variant="destructive" />
            </View>
          </View>
        </View>
      ))}
    </View>
  ),
}

export const FiresOnPress: Story = {
  args: {
    icon: Pencil,
    label: 'Edit entry',
    onPress: fn(),
  },
  play: async ({ canvas, args }) => {
    const button = await canvas.findByRole('button', { name: 'Edit entry' })
    await userEvent.click(button)
    await waitFor(() => expect(args.onPress).toHaveBeenCalledTimes(1))
  },
}

export const DisabledBlocksPress: Story = {
  args: {
    icon: GitBranch,
    label: 'Branch from entry',
    disabled: true,
    disabledReason: 'Generation in progress',
    onPress: fn(),
  },
  play: async ({ canvas, args }) => {
    const button = await canvas.findByRole('button', { name: 'Generation in progress' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(args.onPress).not.toHaveBeenCalled()
  },
}
