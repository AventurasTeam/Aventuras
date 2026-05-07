import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

import { StoryCard, type Story } from './story-card'

const baseStory: Story = {
  id: 's1',
  title: "Aria's Descent",
  description:
    'A former royal guard hunts the Warden through the undercities of Ironshore, hoping to clear her name before the war reaches the capital.',
  genreLabel: 'Dark Fantasy',
  mode: 'adventure',
  accentColor: null,
  favorited: false,
  archived: false,
  isDraft: false,
  chapterLabel: 'Chapter 3',
  lastOpenedRelative: '2h ago',
}

const handlers = {
  onOpen: fn(),
  onToggleFavorite: fn(),
  onArchiveToggle: fn(),
  onEditInfo: fn(),
  onDuplicate: fn(),
  onExport: fn(),
  onDelete: fn(),
}

const meta: Meta<typeof StoryCard> = {
  title: 'Compounds/StoryCard',
  component: StoryCard,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type StoryT = StoryObj<typeof StoryCard>

// Card-width wrapper for the single-card stories. Applied at story
// level (not meta level) so the grid + theme-matrix stories can opt
// into full width by overriding `decorators`. Storybook's decorator
// stacking puts story-level decorators INSIDE meta-level decorators,
// which means a meta-level width cap blocks grid stories from
// fanning out — caught during Electron testing.
const cardCenteredDecorator = (Story: () => React.ReactElement) => (
  <View style={{ width: 320 }}>
    <Story />
  </View>
)
const cardCentered = { decorators: [cardCenteredDecorator] } satisfies Partial<StoryT>

export const Default: StoryT = {
  ...cardCentered,
  args: { story: baseStory, ...handlers },
}

export const Favorited: StoryT = {
  ...cardCentered,
  args: { story: { ...baseStory, favorited: true }, ...handlers },
}

export const Draft: StoryT = {
  ...cardCentered,
  args: {
    story: { ...baseStory, isDraft: true, chapterLabel: null },
    ...handlers,
  },
}

export const Archived: StoryT = {
  ...cardCentered,
  args: { story: { ...baseStory, archived: true }, ...handlers },
}

export const ArchivedDraft: StoryT = {
  ...cardCentered,
  args: {
    story: { ...baseStory, archived: true, isDraft: true, chapterLabel: null },
    ...handlers,
  },
}

export const NoDescription: StoryT = {
  ...cardCentered,
  args: { story: { ...baseStory, description: null }, ...handlers },
}

export const NoGenre: StoryT = {
  ...cardCentered,
  args: { story: { ...baseStory, genreLabel: null }, ...handlers },
}

export const LongTitle: StoryT = {
  ...cardCentered,
  args: {
    story: {
      ...baseStory,
      title: 'A title that runs longer than usual to verify the two-line clamp behavior holds',
    },
    ...handlers,
  },
}

export const CreativeMode: StoryT = {
  ...cardCentered,
  args: {
    story: { ...baseStory, mode: 'creative', genreLabel: 'Cozy Slice-of-Life' },
    ...handlers,
  },
}

export const CustomAccent: StoryT = {
  ...cardCentered,
  args: {
    story: { ...baseStory, accentColor: '#10b981', genreLabel: 'Adventure Sci-Fi' },
    ...handlers,
  },
}

export const FavoriteTogglesIndependent: StoryT = {
  ...cardCentered,
  args: { story: baseStory, ...handlers },
  play: async ({ args }) => {
    const star = screen.getByRole('button', { name: 'Favorite story' })
    await userEvent.click(star)
    await waitFor(() => expect(args.onToggleFavorite).toHaveBeenCalledTimes(1))
    // Star tap MUST NOT bubble to body open. The reverse is guarded
    // by the absolute-positioned overflow in a separate test.
    expect(args.onOpen).not.toHaveBeenCalled()
  },
}

export const OverflowOpensMenu: StoryT = {
  ...cardCentered,
  args: { story: baseStory, ...handlers },
  play: async ({ args }) => {
    const trigger = screen.getByRole('button', { name: 'Story actions' })
    await userEvent.click(trigger)
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument(),
    )
    // Overflow tap MUST NOT bubble to body open.
    expect(args.onOpen).not.toHaveBeenCalled()
  },
}

export const ArchiveLabelFlipsForArchived: StoryT = {
  ...cardCentered,
  args: { story: { ...baseStory, archived: true }, ...handlers },
  play: async () => {
    const trigger = screen.getByRole('button', { name: 'Story actions' })
    await userEvent.click(trigger)
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Unarchive' })).toBeInTheDocument(),
    )
  },
}

export const GridResponsive: StoryT = {
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <View style={{ width: '100%' }}>
        <Story />
      </View>
    ),
  ],
  render: () => (
    <View
      // @ts-expect-error — web-only grid styling on RN-Web.
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}
    >
      {[
        { ...baseStory, id: '1' },
        { ...baseStory, id: '2', favorited: true, title: 'The Iron Pact' },
        { ...baseStory, id: '3', isDraft: true, chapterLabel: null, title: 'Untitled draft' },
        {
          ...baseStory,
          id: '4',
          archived: true,
          mode: 'creative' as const,
          genreLabel: 'Cozy Slice-of-Life',
          title: 'Tea House Diaries',
        },
        {
          ...baseStory,
          id: '5',
          mode: 'creative' as const,
          accentColor: '#10b981',
          genreLabel: 'Solarpunk',
          title: 'Greenhouse Saga',
          description: null,
        },
        {
          ...baseStory,
          id: '6',
          genreLabel: null,
          title: 'No-Genre Story',
        },
      ].map((s) => (
        <StoryCard key={s.id} story={s} {...handlers} />
      ))}
    </View>
  ),
}

export const ThemeMatrix: StoryT = {
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <View style={{ width: '100%' }}>
        <Story />
      </View>
    ),
  ],
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
          <View
            // @ts-expect-error — web-only grid styling on RN-Web.
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
            }}
          >
            <StoryCard story={{ ...baseStory, id: `${t.id}-1` }} {...handlers} />
            <StoryCard story={{ ...baseStory, id: `${t.id}-2`, favorited: true }} {...handlers} />
            <StoryCard
              story={{
                ...baseStory,
                id: `${t.id}-3`,
                mode: 'creative',
                genreLabel: 'Cozy Slice-of-Life',
              }}
              {...handlers}
            />
          </View>
        </View>
      ))}
    </View>
  ),
}
