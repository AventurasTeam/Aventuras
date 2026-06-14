import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { type ReactElement } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import type { StoryCardData } from '@/lib/stores'
import { themes } from '@/lib/themes'

import { StoryCard } from './story-card'

const makeStoryRow = (p: Partial<StoryCardData> & { id: string }): StoryCardData => ({
  title: "Aria's Descent",
  description:
    'A former royal guard hunts the Warden through the undercities of Ironshore, hoping to clear her name before the war reaches the capital.',
  tags: [],
  coverAssetId: null,
  accentColor: null,
  status: 'active',
  favorite: 0,
  lastOpenedAt: null,
  definition: { mode: 'adventure', genre: { label: 'Dark Fantasy' } } as never,
  settings: null,
  createdAt: 1,
  updatedAt: 1,
  currentBranchId: null,
  chapterLabel: 'Chapter 3',
  lastOpenedRelative: '2h ago',
  ...p,
})

const baseStory = makeStoryRow({ id: 's1' })

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
  title: 'Compounds/Story/StoryCard',
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
const cardCenteredDecorator = (Story: () => ReactElement) => (
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
  args: { story: makeStoryRow({ id: 's1', favorite: 1 }), ...handlers },
}

export const Draft: StoryT = {
  ...cardCentered,
  args: {
    story: makeStoryRow({ id: 's1', status: 'draft', chapterLabel: null }),
    ...handlers,
  },
}

export const Archived: StoryT = {
  ...cardCentered,
  args: { story: makeStoryRow({ id: 's1', status: 'archived' }), ...handlers },
}

export const ArchivedDraft: StoryT = {
  ...cardCentered,
  args: {
    story: makeStoryRow({ id: 's1', status: 'archived', chapterLabel: null }),
    ...handlers,
  },
}

export const NoDescription: StoryT = {
  ...cardCentered,
  args: { story: makeStoryRow({ id: 's1', description: null }), ...handlers },
}

export const NoGenre: StoryT = {
  ...cardCentered,
  args: {
    story: makeStoryRow({ id: 's1', definition: { mode: 'adventure' } as never }),
    ...handlers,
  },
}

export const LongTitle: StoryT = {
  ...cardCentered,
  args: {
    story: makeStoryRow({
      id: 's1',
      title: 'A title that runs longer than usual to verify the two-line clamp behavior holds',
    }),
    ...handlers,
  },
}

export const CreativeMode: StoryT = {
  ...cardCentered,
  args: {
    story: makeStoryRow({
      id: 's1',
      definition: { mode: 'creative', genre: { label: 'Cozy Slice-of-Life' } } as never,
    }),
    ...handlers,
  },
}

export const CustomAccent: StoryT = {
  ...cardCentered,
  args: {
    story: makeStoryRow({
      id: 's1',
      accentColor: '#10b981',
      definition: { mode: 'adventure', genre: { label: 'Adventure Sci-Fi' } } as never,
    }),
    ...handlers,
  },
}

export const FavoriteTogglesIndependent: StoryT = {
  ...cardCentered,
  args: { story: baseStory, ...handlers },
  play: async ({ args }) => {
    const star = screen.getByRole('button', { name: t('storyCard.favorite') })
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
    const trigger = screen.getByRole('button', { name: t('storyCard.actionsLabel') })
    await userEvent.click(trigger)
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: t('storyCard.archive') })).toBeInTheDocument(),
    )
    // Overflow tap MUST NOT bubble to body open.
    expect(args.onOpen).not.toHaveBeenCalled()
  },
}

export const DraftHidesArchive: StoryT = {
  ...cardCentered,
  args: { story: makeStoryRow({ id: 's1', status: 'draft', chapterLabel: null }), ...handlers },
  play: async () => {
    const trigger = screen.getByRole('button', { name: t('storyCard.actionsLabel') })
    await userEvent.click(trigger)
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: t('storyCard.delete') })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('menuitem', { name: t('storyCard.archive') })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: t('storyCard.unarchive') }),
    ).not.toBeInTheDocument()
  },
}

export const ArchiveLabelFlipsForArchived: StoryT = {
  ...cardCentered,
  args: { story: makeStoryRow({ id: 's1', status: 'archived' }), ...handlers },
  play: async () => {
    const trigger = screen.getByRole('button', { name: t('storyCard.actionsLabel') })
    await userEvent.click(trigger)
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: t('storyCard.unarchive') })).toBeInTheDocument(),
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
        makeStoryRow({ id: '1' }),
        makeStoryRow({ id: '2', favorite: 1, title: 'The Iron Pact' }),
        makeStoryRow({ id: '3', status: 'draft', chapterLabel: null, title: 'Untitled draft' }),
        makeStoryRow({
          id: '4',
          status: 'archived',
          definition: { mode: 'creative', genre: { label: 'Cozy Slice-of-Life' } } as never,
          title: 'Tea House Diaries',
        }),
        makeStoryRow({
          id: '5',
          accentColor: '#10b981',
          definition: { mode: 'creative', genre: { label: 'Solarpunk' } } as never,
          title: 'Greenhouse Saga',
          description: null,
        }),
        makeStoryRow({
          id: '6',
          definition: { mode: 'adventure' } as never,
          title: 'No-Genre Story',
        }),
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
            <StoryCard story={makeStoryRow({ id: `${t.id}-1` })} {...handlers} />
            <StoryCard story={makeStoryRow({ id: `${t.id}-2`, favorite: 1 })} {...handlers} />
            <StoryCard
              story={makeStoryRow({
                id: `${t.id}-3`,
                definition: { mode: 'creative', genre: { label: 'Cozy Slice-of-Life' } } as never,
              })}
              {...handlers}
            />
          </View>
        </View>
      ))}
    </View>
  ),
}
