import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Skeleton } from './skeleton'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Skeleton> = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Skeleton>

export const Default: Story = {
  render: () => <Skeleton className="h-4 w-48" />,
}

export const Shapes: Story = {
  render: () => (
    <View className="gap-3">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="size-10 rounded-full" />
      <Skeleton className="h-24 w-64 rounded-lg" />
    </View>
  ),
}

// Layout examples — stacking skeletons to mimic real loading
// shapes (entity row, paragraph block, avatar+text combo).
export const EntityRow: Story = {
  render: () => (
    <View className="gap-3" style={{ width: 360 }}>
      <View className="flex-row items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </View>
      </View>
      <View className="flex-row items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </View>
      </View>
      <View className="flex-row items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-44" />
        </View>
      </View>
    </View>
  ),
}

export const Paragraph: Story = {
  render: () => (
    <View className="gap-2" style={{ width: 360 }}>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
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
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="flex-row items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <View className="flex-1 gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </View>
          </View>
        </View>
      ))}
    </View>
  ),
}
