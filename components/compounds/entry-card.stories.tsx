import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { type ReactElement } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { EntryCard, type EntryCardProps } from './entry-card'

const baseProps = {
  worldTimeLabel: 'Day 12 · 14:33',
  onEdit: fn(),
  onDelete: fn(),
  onRegen: fn(),
  onBranch: fn(),
  onFlipEra: fn(),
}

const aiMeta = {
  tokens: { reply: 312, reasoning: 87 },
}

const meta: Meta<typeof EntryCard> = {
  title: 'Compounds/EntryCard',
  component: EntryCard,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type StoryT = StoryObj<typeof EntryCard>

const wrapDecorator = (Story: () => ReactElement) => (
  <View style={{ width: 600 }}>
    <Story />
  </View>
)
const wrap = { decorators: [wrapDecorator] } satisfies Partial<StoryT>

export const UserKind: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'user',
    content: 'I draw my sword and step toward the figure in the doorway, ready to strike.',
  },
}

export const AiKind: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai',
    content:
      'The figure raises a single gloved hand and the air thickens around your blade — you feel the metal hum, then go still in your grip, suddenly heavier than it should be.',
    meta: aiMeta,
    reasoning:
      'The user is being aggressive but the figure is meant to read as a warden — let me lean on supernatural restraint rather than a fight scene. Use kinesthetic detail (sword going still) to telegraph "you cannot win this without thinking".',
  },
}

export const AiNoReasoning: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai',
    content: 'The figure tilts its head, and the air thickens around your blade.',
    meta: { tokens: { reply: 145 } },
  },
}

export const OpeningKind: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    onDelete: undefined, // opening cannot be deleted
    kind: 'opening',
    content:
      'The road from Ironshore is empty for a hundred miles. You have ridden three days; the warden waits at the next bend.',
    meta: { tokens: { reply: 89 } },
  },
}

export const SystemKind: StoryT = {
  ...wrap,
  args: {
    kind: 'system',
    content: 'Generation failed: provider returned 503.',
    detail: 'The model service is temporarily unavailable. Retry in a moment.',
    onRetry: fn(),
    onDismiss: fn(),
  },
}

export const StreamingReasoning: StoryT = {
  ...wrap,
  args: {
    kind: 'streaming',
    streamingPhase: 'reasoning',
    content: 'Thinking about how the warden would respond to direct aggression…',
  },
}

export const StreamingReply: StoryT = {
  ...wrap,
  args: {
    kind: 'streaming',
    streamingPhase: 'reply',
    content: 'The figure raises a single gloved hand and the air thickens around your bla',
  },
}

export const EditMode: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'user',
    content: 'I draw my sword and step toward the figure in the doorway.',
    editing: true,
    onContentChange: fn(),
    onCommitEdit: fn(),
    onCancelEdit: fn(),
  },
}

export const Disabled: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai',
    content: 'The figure raises a single gloved hand.',
    meta: aiMeta,
    disabled: true,
    disabledReason: 'Generation is in flight. Cancel to edit.',
  },
}

export const NoWorldTime: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    worldTimeLabel: undefined,
    kind: 'ai',
    content: 'The figure raises a single gloved hand.',
    meta: aiMeta,
  },
}

export const NoFlipEra: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    onFlipEra: undefined,
    kind: 'ai',
    content: 'The figure raises a single gloved hand.',
    meta: aiMeta,
  },
}

export const ReasoningTogglesOnBrainClick: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai',
    content: 'The figure raises a hand.',
    meta: aiMeta,
    reasoning: 'Lean on restraint, not combat.',
  },
  play: async () => {
    const brain = screen.getByRole('button', { name: 'Show reasoning' })
    // Reasoning hidden initially.
    expect(screen.queryByText('Lean on restraint, not combat.')).not.toBeInTheDocument()
    await userEvent.click(brain)
    await waitFor(() =>
      expect(screen.getByText('Lean on restraint, not combat.')).toBeInTheDocument(),
    )
    // Toggle back.
    const closer = screen.getByRole('button', { name: 'Hide reasoning' })
    await userEvent.click(closer)
    await waitFor(() =>
      expect(screen.queryByText('Lean on restraint, not combat.')).not.toBeInTheDocument(),
    )
  },
}

export const SystemRetryFires: StoryT = {
  ...wrap,
  args: {
    kind: 'system',
    content: 'Generation failed.',
    onRetry: fn(),
    onDismiss: fn(),
  } satisfies EntryCardProps,
  play: async ({ args }) => {
    const retry = screen.getByRole('button', { name: /Retry/ })
    await userEvent.click(retry)
    await waitFor(() => expect(args.onRetry).toHaveBeenCalledTimes(1))
  },
}

export const KindMatrix: StoryT = {
  parameters: { layout: 'padded' },
  render: () => (
    <View className="flex-col gap-4" style={{ maxWidth: 700 }}>
      <EntryCard
        kind="opening"
        content="The road from Ironshore is empty for a hundred miles."
        worldTimeLabel="Day 1 · 06:00"
        meta={{ tokens: { reply: 89 } }}
        onEdit={fn()}
        onBranch={fn()}
        onFlipEra={fn()}
      />
      <EntryCard
        kind="user"
        content="I keep riding."
        worldTimeLabel="Day 1 · 06:05"
        onEdit={fn()}
        onDelete={fn()}
        onFlipEra={fn()}
      />
      <EntryCard
        kind="ai"
        content="At the next bend, a figure in dust-grey waits."
        worldTimeLabel="Day 1 · 09:14"
        meta={aiMeta}
        reasoning="Setup the warden encounter."
        onEdit={fn()}
        onDelete={fn()}
        onRegen={fn()}
        onBranch={fn()}
        onFlipEra={fn()}
      />
      <EntryCard
        kind="streaming"
        streamingPhase="reasoning"
        content="Working out the warden's first words…"
      />
      <EntryCard
        kind="system"
        content="Provider returned 503."
        detail="Model service temporarily unavailable."
        onRetry={fn()}
        onDismiss={fn()}
      />
    </View>
  ),
}

export const ThemeMatrix: StoryT = {
  parameters: { layout: 'padded' },
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
          <View className="flex-col gap-3">
            <EntryCard
              kind="user"
              content="I keep riding."
              worldTimeLabel="Day 1 · 06:05"
              onEdit={fn()}
              onDelete={fn()}
            />
            <EntryCard
              kind="ai"
              content="At the next bend, a figure in dust-grey waits."
              worldTimeLabel="Day 1 · 09:14"
              meta={aiMeta}
              onEdit={fn()}
              onDelete={fn()}
              onRegen={fn()}
              onBranch={fn()}
            />
          </View>
        </View>
      ))}
    </View>
  ),
}
