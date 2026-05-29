import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { ListRow } from './list-row'

const meta: Meta<typeof ListRow> = {
  title: 'Compounds/ListRow',
  component: ListRow,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="rounded-md bg-bg-base" style={{ width: 380 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ListRow>

/**
 * Minimal — no leading, no meta, no trailing. Single-line label.
 * The label is what the row carries when nothing else is set.
 */
export const Minimal: Story = {
  args: {
    label: 'Plain row',
    onPress: fn(),
  },
}

/**
 * Entity-shaped row — leading kind icon + label + trailing status
 * tag. Mirrors the World/Browse-rail entity-row composition.
 */
export const EntityRow: Story = {
  render: (args) => (
    <ListRow
      {...args}
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      trailing={<Tag>active</Tag>}
      onPress={fn()}
    />
  ),
}

/**
 * Lead character — `meta` slot carries the inline gold lead-badge.
 * Tag is a stand-in for the eventual gold-pill; ListRow doesn't
 * own the badge styling.
 */
export const LeadCharacter: Story = {
  render: () => (
    <ListRow
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      meta={<Tag>You</Tag>}
      trailing={<Tag>active</Tag>}
      onPress={fn()}
    />
  ),
}

/**
 * Description renders as a second line, truncated at 2 lines.
 * Threads use this; entities don't.
 */
export const WithDescription: Story = {
  render: () => (
    <ListRow
      label="The Empress's missing courier"
      description="Long-running thread spanning chapters 3–7. The courier carried a sealed message that has not been delivered."
      trailing={<Tag>active</Tag>}
      onPress={fn()}
    />
  ),
}

/**
 * Scene-presence stripe — 3 px green left-edge accent. Channel
 * separation rule: left-edge belongs to scene-presence and only
 * scene-presence.
 */
export const InScene: Story = {
  render: () => (
    <ListRow
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      meta={<Tag>You</Tag>}
      trailing={<Tag>active</Tag>}
      inScene
      onPress={fn()}
    />
  ),
}

/**
 * Recently-classified — fresh state, full info-blue tint.
 */
export const RecentlyClassifiedFresh: Story = {
  render: () => (
    <ListRow
      label="Lord Hamasaki"
      leading={<EntityKindIcon kind="character" />}
      trailing={<Tag>staged</Tag>}
      recentlyClassified="fresh"
      onPress={fn()}
    />
  ),
}

/**
 * Recently-classified — fading state, half-opacity tint.
 */
export const RecentlyClassifiedFading: Story = {
  render: () => (
    <ListRow
      label="Lord Hamasaki"
      leading={<EntityKindIcon kind="character" />}
      trailing={<Tag>staged</Tag>}
      recentlyClassified="fading"
      onPress={fn()}
    />
  ),
}

/**
 * Both channels firing — green left-edge stripe AND info-blue
 * body tint. The two primitives don't contend; this is the
 * "in-scene character whose state was just classifier-written"
 * combination explicitly called out in the spec.
 */
export const InSceneAndRecentlyClassified: Story = {
  render: () => (
    <ListRow
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      meta={<Tag>You</Tag>}
      trailing={<Tag>active</Tag>}
      inScene
      recentlyClassified="fresh"
      onPress={fn()}
    />
  ),
}

/**
 * Selected state — depressed-surface background. Master-detail
 * surfaces use this for the currently-loaded detail row.
 */
export const Selected: Story = {
  render: () => (
    <ListRow
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      trailing={<Tag>active</Tag>}
      selected
      onPress={fn()}
    />
  ),
}

/**
 * Selected + recently-classified — recently-classified wins, per
 * the design rule. Transient signal beats persistent.
 */
export const SelectedAndRecentlyClassified: Story = {
  render: () => (
    <ListRow
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      trailing={<Tag>active</Tag>}
      selected
      recentlyClassified="fresh"
      onPress={fn()}
    />
  ),
}

/**
 * Disabled — non-interactive, no press, no hover, opacity drop.
 * Useful for retired entries that shouldn't be tappable.
 */
export const Disabled: Story = {
  render: () => (
    <ListRow
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      trailing={<Tag>retired</Tag>}
      disabled
      onPress={fn()}
    />
  ),
}

/**
 * Stack of varied rows — visually demonstrates the sort and
 * channel-stacking story across a realistic list pane.
 */
export const ListPane: Story = {
  render: () => (
    <View>
      <ListRow
        label="Aiko"
        leading={<EntityKindIcon kind="character" />}
        meta={<Tag>You</Tag>}
        trailing={<Tag>active</Tag>}
        inScene
        onPress={fn()}
      />
      <ListRow
        label="Lord Hamasaki"
        leading={<EntityKindIcon kind="character" />}
        trailing={<Tag>staged</Tag>}
        recentlyClassified="fresh"
        onPress={fn()}
      />
      <ListRow
        label="Reiko"
        leading={<EntityKindIcon kind="character" />}
        trailing={<Tag>active</Tag>}
        selected
        onPress={fn()}
      />
      <ListRow
        label="The Empress's missing courier"
        description="Long-running thread spanning chapters 3–7."
        trailing={<Tag>active</Tag>}
        onPress={fn()}
      />
      <ListRow
        label="Yumi"
        leading={<EntityKindIcon kind="character" />}
        trailing={<Tag>retired</Tag>}
        disabled
        onPress={fn()}
      />
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-3" style={{ width: '100%' }}>
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-2"
        >
          <Text variant="muted" size="sm" className="px-2 pb-1">
            {t.name}
          </Text>
          <ListRow
            label="Aiko"
            leading={<EntityKindIcon kind="character" />}
            meta={<Tag>You</Tag>}
            trailing={<Tag>active</Tag>}
            inScene
            recentlyClassified="fresh"
            onPress={fn()}
          />
          <ListRow
            label="Lord Hamasaki"
            leading={<EntityKindIcon kind="character" />}
            trailing={<Tag>staged</Tag>}
            selected
            onPress={fn()}
          />
        </View>
      ))}
    </View>
  ),
}

export const PressFiresOnTap: Story = {
  args: { onPress: fn() },
  render: (args) => (
    <ListRow
      {...args}
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      trailing={<Tag>active</Tag>}
    />
  ),
  play: async ({ args }) => {
    const row = screen.getByRole('button', { name: 'Aiko' })
    await userEvent.click(row)
    await waitFor(() => expect(args.onPress).toHaveBeenCalled())
  },
}

export const DisabledDoesNotFire: Story = {
  args: { onPress: fn() },
  render: (args) => (
    <ListRow
      {...args}
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      trailing={<Tag>retired</Tag>}
      disabled
    />
  ),
  play: async ({ args }) => {
    // Disabled rows don't carry the button role at all — no element
    // to dispatch onPress against.
    expect(screen.queryByRole('button', { name: 'Aiko' })).not.toBeInTheDocument()
    expect(args.onPress).not.toHaveBeenCalled()
  },
}
