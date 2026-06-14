import { type ReactNode } from 'react'
import { Platform, View } from 'react-native'

import { StoryCard } from '@/components/compounds/story-card'
import { Toolbar } from '@/components/compounds/toolbar'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import type { StoryCardVM, StoryFilter, StoryListQuery, StorySort } from '@/lib/stores'

const SEARCH_SCOPE = ['title', 'description', 'genre', 'tags'] as const
const SORT_OPTIONS = [
  { value: 'last-opened', label: t('landing:list.sortLastOpened') },
  { value: 'created', label: t('landing:list.sortCreated') },
  { value: 'title', label: t('landing:list.sortTitle') },
]

export type StoryCardHandlers = {
  onOpen: () => void
  onToggleFavorite: () => void
  onArchiveToggle: () => void
  onDelete: () => void
}

type StoryListProps = {
  cards: StoryCardVM[]
  totalCount: number
  query: StoryListQuery
  onSearch: (v: string) => void
  onFilter: (f: StoryFilter) => void
  onSort: (s: StorySort) => void
  onNewStory: () => void
  cardHandlers: (storyId: string) => StoryCardHandlers
  banner?: ReactNode
}

export function StoryList({
  cards,
  totalCount,
  query,
  onSearch,
  onFilter,
  onSort,
  onNewStory,
  cardHandlers,
  banner,
}: StoryListProps) {
  const isEmpty = totalCount === 0
  return (
    <View className="flex-1">
      {banner}
      <View className="gap-3 p-4">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Text className="font-semibold">
            {`${t('landing:list.title')} · ${t('landing:list.total', { count: totalCount })}`}
          </Text>
          {!isEmpty ? (
            <Button variant="secondary" onPress={onNewStory}>
              <Text>{t('landing:list.newStory')}</Text>
            </Button>
          ) : null}
        </View>

        {isEmpty ? (
          <View className="flex-1 items-center justify-center gap-6 p-6">
            <EmptyState
              title={t('landing:list.welcomeTitle')}
              subtext={t('landing:list.welcomeBody')}
            />
            <Button onPress={onNewStory}>
              <Text>{t('landing:list.createFirst')}</Text>
            </Button>
          </View>
        ) : (
          <>
            <Toolbar>
              <Toolbar.Search
                value={query.search}
                onChange={onSearch}
                placeholder={t('landing:list.searchPlaceholder')}
                scope={SEARCH_SCOPE}
              />
              <Toolbar.FilterChips>
                <Chip selected={query.filter === 'all'} onPress={() => onFilter('all')}>
                  {t('landing:list.filterAll')}
                </Chip>
                <Chip selected={query.filter === 'favorited'} onPress={() => onFilter('favorited')}>
                  {t('landing:list.filterFavorited')}
                </Chip>
                <Chip selected={query.filter === 'archived'} onPress={() => onFilter('archived')}>
                  {t('landing:list.filterArchived')}
                </Chip>
              </Toolbar.FilterChips>
              <Toolbar.Sort
                value={query.sort}
                onChange={(v) => onSort(v as StorySort)}
                options={SORT_OPTIONS}
                label={t('landing:list.sortLabel')}
              />
            </Toolbar>

            <View
              // @ts-expect-error — web grid styling on RN-Web; native falls back to flex wrap.
              style={Platform.select({
                web: {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 16,
                },
                default: undefined,
              })}
              className={Platform.OS === 'web' ? '' : 'flex-row flex-wrap gap-4'}
            >
              {cards.map((c) => {
                const h = cardHandlers(c.id)
                return <StoryCard key={c.id} story={c} {...h} />
              })}
            </View>
          </>
        )}
      </View>
    </View>
  )
}

export type { StoryListProps }
