import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Text> = {
  title: 'Primitives/Text',
  component: Text,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'muted', 'disabled'],
    },
    size: {
      control: 'select',
      options: ['xs', 'sm', 'base', 'lg', 'xl'],
    },
    headingLevel: {
      control: 'select',
      options: [undefined, 1, 2, 3, 4, 5, 6],
    },
  },
}

export default meta
type Story = StoryObj<typeof Text>

export const Default: Story = {
  args: { children: 'The quick brown fox jumps over the lazy dog.' },
}

export const Variants: Story = {
  render: () => (
    <View className="flex-col gap-2">
      <Text variant="default">Default — primary foreground</Text>
      <Text variant="secondary">Secondary — secondary foreground</Text>
      <Text variant="muted">Muted — muted foreground</Text>
      <Text variant="disabled">Disabled — disabled foreground</Text>
    </View>
  ),
}

export const Sizes: Story = {
  render: () => (
    <View className="flex-col items-start gap-2">
      <Text size="xs">Extra small (xs)</Text>
      <Text size="sm">Small (sm)</Text>
      <Text size="base">Base (default)</Text>
      <Text size="lg">Large (lg)</Text>
      <Text size="xl">Extra large (xl)</Text>
    </View>
  ),
}

export const Headings: Story = {
  render: () => (
    <View className="flex-col items-start gap-3">
      <Text variant="muted" size="xs">
        headingLevel sets role=&quot;heading&quot; + aria-level. Visual styling stays orthogonal
        (size + className).
      </Text>
      <Text headingLevel={1} size="xl" className="font-semibold">
        Heading level 1
      </Text>
      <Text headingLevel={2} size="lg" className="font-semibold">
        Heading level 2
      </Text>
      <Text headingLevel={3} size="base" className="font-semibold">
        Heading level 3
      </Text>
      <Text headingLevel={4} size="base" className="font-medium">
        Heading level 4
      </Text>
      <Text headingLevel={5} size="sm" className="font-medium">
        Heading level 5
      </Text>
      <Text headingLevel={6} size="sm" variant="muted">
        Heading level 6
      </Text>
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-6">
      {themes.map((t) => (
        <View
          key={t.id}
          // RN-Web forwards `dataSet` to `data-*` attributes per the
          // ThemeMatrix scoping pattern; same approach Button uses.
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col gap-2 rounded-md bg-bg-base p-4"
        >
          <Text variant="muted" size="xs">
            {t.name}
          </Text>
          <Text variant="default">Default — primary foreground</Text>
          <Text variant="secondary">Secondary — secondary foreground</Text>
          <Text variant="muted">Muted — muted foreground</Text>
          <Text variant="disabled">Disabled — disabled foreground</Text>
        </View>
      ))}
    </View>
  ),
}
