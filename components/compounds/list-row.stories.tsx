import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { Star } from 'lucide-react-native'
import { View } from 'react-native'
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { expectInsetFocusRing } from '@/components/ui/focus-ring-probe'
import { Icon } from '@/components/ui/icon'
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

/** Hovers the row with a real pointer and returns its background; null outside Vitest. */
async function backgroundOnHover(name: string): Promise<{ idle: string; hovered: string } | null> {
  const row = screen.getByRole('button', { name })
  const idle = getComputedStyle(row).backgroundColor
  const browser = await import('vitest/browser').catch(() => null)
  if (browser == null) return null
  await browser.userEvent.hover(row)
  return { idle, hovered: getComputedStyle(row).backgroundColor }
}

/**
 * Minimal — no leading, no meta, no trailing. Single-line label.
 * The label is what the row carries when nothing else is set.
 */
export const Minimal: Story = {
  args: {
    label: 'Plain row',
    onPress: fn(),
  },
  play: async () => {
    await expectInsetFocusRing(await screen.findByRole('button', { name: 'Plain row' }))
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
 * Lead character — `meta` carries the lead badge; ListRow doesn't style it.
 */
export const LeadCharacter: Story = {
  render: () => (
    <ListRow
      label="Aiko"
      leading={<EntityKindIcon kind="character" />}
      meta={
        <Tag
          tone="accent"
          leading={<Icon as={Star} aria-hidden size="sm" className="fill-accent-fg" />}
        >
          You
        </Tag>
      }
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
  play: async () => {
    expect(
      screen.getByRole('button', { name: "The Empress's missing courier" }),
    ).toHaveAccessibleDescription(
      'Long-running thread spanning chapters 3–7. The courier carried a sealed message that has not been delivered.',
    )
  },
}

/** No press: the row isn't a control, so it isn't named, focusable or announced as disabled. */
export const DisplayOnlyIsNotAControl: Story = {
  render: () => (
    <ListRow
      label="Aiko"
      description="Archivist of the eastern wing"
      leading={<EntityKindIcon kind="character" />}
    />
  ),
  play: async ({ canvasElement }) => {
    expect(screen.queryByRole('button')).toBeNull()
    expect(canvasElement.querySelector('[aria-disabled]')).toBeNull()
    expect(canvasElement.querySelector('[aria-label="Aiko"]')).toBeNull()
    expect(canvasElement.querySelector('[tabindex]')).toBeNull()
    expect(screen.getByText('Archivist of the eastern wing')).toBeVisible()
  },
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
  // The tint is the signal; hovering must not replace it.
  play: async () => {
    const bg = await backgroundOnHover('Lord Hamasaki')
    if (bg != null) expect(bg.hovered).toBe(bg.idle)
  },
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
  play: async () => {
    const bg = await backgroundOnHover('Aiko')
    if (bg != null) expect(bg.hovered).toBe(bg.idle)
  },
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
    const row = screen.getByRole('button', { name: 'Aiko' })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(row)
    expect(args.onPress).not.toHaveBeenCalled()
  },
}

export const DisabledNamesItsReason: Story = {
  render: () => (
    <ListRow
      label="Aiko"
      description="Archivist of the eastern wing"
      disabled
      disabledReason="Retired characters can't be edited"
      onPress={fn()}
    />
  ),
  play: async () => {
    const row = screen.getByRole('button', { name: "Aiko, Retired characters can't be edited" })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(row).toHaveAccessibleDescription('Archivist of the eastern wing')
  },
}
