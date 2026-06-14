import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { fn } from 'storybook/test'

import { Banner } from '@/components/ui/banner'
import type { StoryCardData } from '@/lib/stores'

import { StoryList } from './story-list'

const makeCard = (p: Partial<StoryCardData> & { id: string }): StoryCardData => ({
  title: p.id,
  description: 'A short blurb.',
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
  lastOpenedRelative: '2h ago',
  chapterLabel: null,
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
  makeCard({ id: 'Aria', favorite: 1 }),
  makeCard({ id: 'Iron' }),
  makeCard({ id: 'Mornstone' }),
]

export const Populated: T = { args: { ...base, cards, totalCount: 3 } }
export const Empty: T = { args: { ...base, cards: [], totalCount: 0 } }
export const WithDrafts: T = {
  args: {
    ...base,
    totalCount: 2,
    cards: [
      makeCard({ id: 'Untitled', status: 'draft', definition: null }),
      makeCard({ id: 'Iron' }),
    ],
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
