import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

import { DeltaLogRow, type Delta } from './delta-log-row'

const baseDelta: Delta = {
  id: 'delta-1',
  op: 'update',
  source: 'ai_classifier',
  targetTable: 'entities',
  targetDisplayName: 'Kael',
  fieldPath: 'state.traits',
  summary: 'Added "former soldier"; was ["brave", "loyal"]',
  entryId: 'entry #47',
  createdAtRelative: '2h ago',
  actionId: 'action-1',
}

const meta: Meta<typeof DeltaLogRow> = {
  title: 'Compounds/DeltaLogRow',
  component: DeltaLogRow,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="rounded-md border border-border bg-bg-base" style={{ width: 480 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DeltaLogRow>

export const UpdateOp: Story = {
  args: { delta: baseDelta, onPress: fn() },
}

export const CreateOp: Story = {
  args: {
    delta: {
      ...baseDelta,
      id: 'delta-2',
      op: 'create',
      fieldPath: null,
      summary: 'Created',
    },
    onPress: fn(),
  },
}

export const DeleteOp: Story = {
  args: {
    delta: {
      ...baseDelta,
      id: 'delta-3',
      op: 'delete',
      fieldPath: null,
      summary: 'Deleted',
    },
    onPress: fn(),
  },
}

export const SourceUserEdit: Story = {
  args: { delta: { ...baseDelta, source: 'user_edit' }, onPress: fn() },
}

export const SourceLoreAgent: Story = {
  args: { delta: { ...baseDelta, source: 'lore_agent' }, onPress: fn() },
}

export const SourceMemoryCompaction: Story = {
  args: {
    delta: {
      ...baseDelta,
      source: 'memory_compaction',
      entryId: null,
      summary: 'Compacted 12 entries into long-term memory',
    },
    onPress: fn(),
  },
}

export const SourceChapterClose: Story = {
  args: {
    delta: {
      ...baseDelta,
      source: 'chapter_close',
      entryId: null,
      summary: 'Chapter 3 closed; world snapshot taken',
    },
    onPress: fn(),
  },
}

export const NoEntryLink: Story = {
  args: {
    delta: { ...baseDelta, entryId: null },
    onPress: fn(),
  },
}

export const NoFieldPath: Story = {
  args: {
    delta: { ...baseDelta, op: 'create', fieldPath: null, summary: 'Created' },
    onPress: fn(),
  },
}

export const LongTargetName: Story = {
  args: {
    delta: {
      ...baseDelta,
      targetDisplayName:
        'A character with an unusually long display name that should truncate inline',
      fieldPath: 'state.relationships.factions[2].standing',
    },
    onPress: fn(),
  },
}

export const LongSummary: Story = {
  args: {
    delta: {
      ...baseDelta,
      summary:
        'A long summary that should clamp to two lines and ellipsize cleanly. The host format covers the diff so the row can leave overflow rendering to the layout layer; consumers should expect the bound at exactly two lines so the meta strip keeps its baseline.',
    },
    onPress: fn(),
  },
}

export const NonInteractive: Story = {
  args: { delta: baseDelta },
}

export const PressFires: Story = {
  args: { delta: baseDelta, onPress: fn() },
  play: async ({ args }) => {
    const button = screen.getByRole('button', { name: /update Kael/ })
    await userEvent.click(button)
    await waitFor(() => expect(args.onPress).toHaveBeenCalledTimes(1))
  },
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-3">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="overflow-hidden rounded-md border border-border bg-bg-base p-3"
        >
          <View className="pb-2">
            <Text variant="muted" size="xs">
              {t.name}
            </Text>
          </View>
          <View className="flex-col">
            <DeltaLogRow
              delta={{
                ...baseDelta,
                id: `${t.id}-create`,
                op: 'create',
                fieldPath: null,
                summary: 'Created',
              }}
              onPress={fn()}
            />
            <DeltaLogRow delta={{ ...baseDelta, id: `${t.id}-update` }} onPress={fn()} />
            <DeltaLogRow
              delta={{
                ...baseDelta,
                id: `${t.id}-delete`,
                op: 'delete',
                fieldPath: null,
                summary: 'Deleted',
              }}
              onPress={fn()}
            />
          </View>
        </View>
      ))}
    </View>
  ),
}
