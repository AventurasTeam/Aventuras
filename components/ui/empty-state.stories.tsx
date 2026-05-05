import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { EmptyState } from './empty-state'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof EmptyState> = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof EmptyState>

export const Default: Story = {
  args: { title: 'No threads on this branch yet.' },
}

export const WithSubtext: Story = {
  args: {
    title: 'No threads on this branch yet.',
    subtext:
      'The classifier writes most rows automatically as the story progresses. You can also add them manually with + New below.',
  },
}

/**
 * Sub-text accepts a ReactNode so consumers can inline bold markers
 * like the literal `+ New` / `+ Add` affordance reference, matching
 * the spec's canonical sub-text wording.
 */
export const WithRichSubtext: Story = {
  args: {
    title: 'No threads on this branch yet.',
    subtext: (
      <>
        The classifier writes most rows automatically as the story progresses. You can also add them
        manually with <Text className="font-medium">+ New</Text> below.
      </>
    ),
  },
}

export const KindVariations: Story = {
  render: () => (
    <View className="flex-col gap-6">
      <View className="rounded-md border border-border bg-bg-base">
        <EmptyState
          title="No characters on this branch yet."
          subtext={
            <>
              The classifier writes most rows automatically as the story progresses. You can also
              add them manually with <Text className="font-medium">+ New</Text> below.
            </>
          }
        />
      </View>
      <View className="rounded-md border border-border bg-bg-base">
        <EmptyState
          title="No involvements yet."
          subtext={
            <>
              Add one with <Text className="font-medium">+ Add involvement</Text> below.
            </>
          }
        />
      </View>
      <View className="rounded-md border border-border bg-bg-base">
        <EmptyState
          title="No history yet."
          subtext="Edits and rollbacks will appear here as they happen."
        />
      </View>
    </View>
  ),
}

/**
 * In a real list-pane body the parent provides a definite height
 * (flex-1 inside a flex-column shell). EmptyState's internal
 * `justify-center` centers vertically inside that body. This story
 * fakes the parent shell with a fixed height to demonstrate the
 * fill + center behavior.
 */
export const InListPane: Story = {
  render: () => (
    <View className="h-80 w-96 flex-col rounded-md border border-border bg-bg-base">
      <View className="border-b border-border px-3 py-2">
        <Text size="sm" variant="muted">
          Toolbar (filter chips · search · sort)
        </Text>
      </View>
      <View className="flex-1">
        <EmptyState
          title="No threads on this branch yet."
          subtext={
            <>
              The classifier writes most rows automatically as the story progresses. You can also
              add them manually with <Text className="font-medium">+ New</Text> below.
            </>
          }
          className="flex-1"
        />
      </View>
      <View className="border-t border-border px-3 py-2">
        <Text size="sm" variant="muted">
          + New thread
        </Text>
      </View>
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
          <View className="rounded-md border border-border">
            <EmptyState
              title="No threads on this branch yet."
              subtext={
                <>
                  Add one with <Text className="font-medium">+ New</Text> below.
                </>
              }
            />
          </View>
        </View>
      ))}
    </View>
  ),
}
