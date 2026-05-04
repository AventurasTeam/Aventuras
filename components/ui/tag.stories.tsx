import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Tag } from './tag'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Tag> = {
  title: 'Primitives/Tag',
  component: Tag,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Tag>

export const Static: Story = {
  render: () => (
    <View className="flex-row gap-2">
      <Tag>tag-name</Tag>
      <Tag>another</Tag>
      <Tag>multi-word tag</Tag>
    </View>
  ),
}

export const Removable: Story = {
  render: () => {
    const [tags, setTags] = React.useState(['fantasy', 'high-magic', 'ensemble'])
    return (
      <View className="flex-row flex-wrap gap-2" style={{ maxWidth: 360 }}>
        {tags.map((t) => (
          <Tag key={t} removable onRemove={() => setTags((prev) => prev.filter((x) => x !== t))}>
            {t}
          </Tag>
        ))}
        {tags.length === 0 ? (
          <Text variant="muted" size="sm">
            (all removed)
          </Text>
        ) : null}
      </View>
    )
  },
}

export const SoftTone: Story = {
  render: () => (
    <View className="flex-row gap-2">
      <Tag tone="soft">@kael</Tag>
      <Tag tone="soft">@elara</Tag>
      <Tag tone="soft" onPress={() => {}}>
        @darius
      </Tag>
    </View>
  ),
}

export const AddAffordance: Story = {
  render: () => (
    <View className="flex-row gap-2">
      <Tag>fantasy</Tag>
      <Tag>high-magic</Tag>
      <Tag dashed onPress={() => {}}>
        + tag
      </Tag>
    </View>
  ),
}

export const Disabled: Story = {
  render: () => (
    <View className="flex-row gap-2">
      <Tag disabled>disabled</Tag>
      <Tag disabled removable onRemove={() => {}}>
        disabled removable
      </Tag>
    </View>
  ),
}

export const Clickable: Story = {
  render: () => (
    <View className="flex-row gap-2">
      <Tag onPress={() => {}}>clickable label</Tag>
    </View>
  ),
}

export const MixedRow: Story = {
  render: () => (
    <View className="flex-row flex-wrap gap-2" style={{ maxWidth: 480 }}>
      <Tag tone="soft">@kael</Tag>
      <Tag>fantasy</Tag>
      <Tag>high-magic</Tag>
      <Tag tone="soft">@elara</Tag>
      <Tag removable onRemove={() => {}}>
        ensemble
      </Tag>
      <Tag dashed onPress={() => {}}>
        + tag
      </Tag>
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
          className="rounded-md bg-bg-base p-3"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Tag>tag</Tag>
            <Tag tone="soft">@entity-ref</Tag>
            <Tag removable onRemove={() => {}}>
              removable
            </Tag>
            <Tag dashed onPress={() => {}}>
              + add
            </Tag>
          </View>
        </View>
      ))}
    </View>
  ),
}
