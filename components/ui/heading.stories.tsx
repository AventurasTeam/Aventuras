import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Heading } from './heading'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Heading> = {
  title: 'Primitives/Heading',
  component: Heading,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    level: { control: 'select', options: [1, 2, 3, 4, 5, 6] },
    size: {
      control: 'select',
      options: [undefined, 'xs', 'sm', 'base', 'lg', 'xl'],
    },
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'muted', 'disabled'],
    },
  },
  args: { level: 2 },
}

export default meta
type Story = StoryObj<typeof Heading>

export const Default: Story = {
  args: { children: 'Section title' },
}

export const Levels: Story = {
  render: () => (
    <View className="flex-col items-start gap-3">
      <Text variant="muted" size="xs">
        level drives role=&quot;heading&quot; + aria-level; size + weight defaults bake in per
        level.
      </Text>
      <Heading level={1}>Heading level 1 — page title</Heading>
      <Heading level={2}>Heading level 2 — section title</Heading>
      <Heading level={3}>Heading level 3 — sub-section title</Heading>
      <Heading level={4}>Heading level 4</Heading>
      <Heading level={5}>Heading level 5</Heading>
      <Heading level={6}>Heading level 6</Heading>
    </View>
  ),
}

export const Override: Story = {
  render: () => (
    <View className="flex-col items-start gap-3">
      <Text variant="muted" size="xs">
        Defaults stay opt-out; override `size` or pass `className` for non-default treatment.
        `level` keeps the semantic role + aria-level.
      </Text>
      <Heading level={2} size="xl">
        level 2, size override → xl
      </Heading>
      <Heading level={3} className="font-bold">
        level 3, weight override → font-bold
      </Heading>
      <Heading level={1} variant="muted">
        level 1, variant=muted
      </Heading>
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
          <Text variant="muted" size="xs">
            {t.name}
          </Text>
          <Heading level={1}>Heading 1</Heading>
          <Heading level={2}>Heading 2</Heading>
          <Heading level={3}>Heading 3</Heading>
          <Heading level={4}>Heading 4</Heading>
          <Heading level={5}>Heading 5</Heading>
          <Heading level={6}>Heading 6</Heading>
        </View>
      ))}
    </View>
  ),
}
