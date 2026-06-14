import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { fn } from 'storybook/test'

import { Banner } from '@/components/ui/banner'
import type { StoryCardVM } from '@/lib/stores'

import { StoryList } from './story-list'

const card = (p: Partial<StoryCardVM> & { id: string }): StoryCardVM => ({
  title: p.id,
  description: 'A short blurb.',
  genreLabel: 'Dark Fantasy',
  mode: 'adventure',
  accentColor: null,
  favorited: false,
  archived: false,
  isDraft: false,
  chapterLabel: null,
  lastOpenedRelative: '2h ago',
  ...p,
})

const base = {
  query: { search: '', filter: 'all' as const, sort: 'last-opened' as const },
  onSearch: fn(),
  onFilter: fn(),
  onSort: fn(),
  onNewStory: fn(),
  cardHandlers: () => ({
    onOpen: fn(),
    onToggleFavorite: fn(),
    onArchiveToggle: fn(),
    onDelete: fn(),
  }),
}

const meta: Meta<typeof StoryList> = {
  title: 'Story/StoryList',
  component: StoryList,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (S) => (
      <View style={{ width: '100%' }}>
        <S />
      </View>
    ),
  ],
}
export default meta
type T = StoryObj<typeof StoryList>

const cards = [
  card({ id: 'Aria', favorited: true }),
  card({ id: 'Iron' }),
  card({ id: 'Mornstone' }),
]

export const Populated: T = { args: { ...base, cards, totalCount: 3 } }
export const Empty: T = { args: { ...base, cards: [], totalCount: 0 } }
export const WithDrafts: T = {
  args: {
    ...base,
    totalCount: 2,
    cards: [card({ id: 'Untitled', isDraft: true, genreLabel: null }), card({ id: 'Iron' })],
  },
}
export const WithBanner: T = {
  args: {
    ...base,
    cards,
    totalCount: 3,
    banner: (
      <Banner message="AI generation not configured." ctaLabel="Set up a provider →" onCta={fn()} />
    ),
  },
}
export const NoResults: T = {
  args: {
    ...base,
    cards: [],
    totalCount: 5,
    query: { search: 'zzz', filter: 'all', sort: 'last-opened' },
  },
}
