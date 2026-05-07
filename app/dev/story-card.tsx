import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { StoryCard, type Story } from '@/components/compounds/story-card'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

const SAMPLE_STORIES: Story[] = [
  {
    id: '1',
    title: "Aria's Descent",
    description:
      'A former royal guard hunts the Warden through the undercities of Ironshore, hoping to clear her name before the war reaches the capital.',
    genreLabel: 'Dark Fantasy',
    mode: 'adventure',
    accentColor: null,
    favorited: true,
    archived: false,
    isDraft: false,
    chapterLabel: 'Chapter 3',
    lastOpenedRelative: '2h ago',
  },
  {
    id: '2',
    title: 'The Iron Pact',
    description: 'Three rival houses negotiate peace at a wedding nobody wanted.',
    genreLabel: 'Political Drama',
    mode: 'adventure',
    accentColor: '#dc2626',
    favorited: false,
    archived: false,
    isDraft: false,
    chapterLabel: 'Chapter 1',
    lastOpenedRelative: '5d ago',
  },
  {
    id: '3',
    title: 'Untitled draft',
    description: null,
    genreLabel: null,
    mode: 'adventure',
    accentColor: null,
    favorited: false,
    archived: false,
    isDraft: true,
    chapterLabel: null,
    lastOpenedRelative: '1h ago',
  },
  {
    id: '4',
    title: 'Tea House Diaries',
    description:
      "Slice-of-life vignettes from a tea house at the edge of the world. Each entry follows a single guest's day.",
    genreLabel: 'Cozy Slice-of-Life',
    mode: 'creative',
    accentColor: null,
    favorited: false,
    archived: true,
    isDraft: false,
    chapterLabel: 'Chapter 7',
    lastOpenedRelative: '3w ago',
  },
  {
    id: '5',
    title: 'Greenhouse Saga',
    description: null,
    genreLabel: 'Solarpunk',
    mode: 'creative',
    accentColor: '#10b981',
    favorited: true,
    archived: false,
    isDraft: false,
    chapterLabel: 'Chapter 12',
    lastOpenedRelative: '12h ago',
  },
  {
    id: '6',
    title: 'A title that runs long enough to verify the two-line truncation behavior',
    description: 'Short description.',
    genreLabel: 'Misc',
    mode: 'adventure',
    accentColor: null,
    favorited: false,
    archived: false,
    isDraft: false,
    chapterLabel: 'Chapter 1',
    lastOpenedRelative: 'just now',
  },
]

export default function StoryCardDevRoute() {
  const [stories, setStories] = React.useState(SAMPLE_STORIES)
  const [lastAction, setLastAction] = React.useState<string | null>(null)
  const tier = useTier()
  // Cross-platform multi-column: pick fractional widths via tier so
  // RN doesn't need calc(). Per pattern doc — phone:1, tablet:2-3,
  // desktop:4+. Production Story List screen will swap this for a
  // FlatList numColumns calc.
  const colClass = tier === 'phone' ? 'w-full' : tier === 'tablet' ? 'w-1/2' : 'w-1/4'

  const updateStory = (id: string, partial: Partial<Story>) => {
    setStories((prev) => prev.map((s) => (s.id === id ? { ...s, ...partial } : s)))
  }

  const recordAction = (action: string, id: string) => {
    setLastAction(`${action} → ${id}`)
  }

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-10 p-4">
        <View className="gap-3">
          <Heading level={2}>Story List grid</Heading>
          <Text size="sm" variant="muted">
            Live grid — favorite, archive, and other actions update the local state below.
          </Text>
          {lastAction != null ? (
            <Text size="xs" variant="muted">
              Last: {lastAction}
            </Text>
          ) : null}
          {/* Cross-platform multi-column. Wrapper has -mx-2 to flush
              the grid edges to its parent; cells have p-2 which
              creates 16 px gaps between cards (8 + 8) without using
              `gap` (avoids RN gap quirks) and without calc()
              (unsupported on native). Width via simple fractions
              picked from `useTier()` above. */}
          <View className="-mx-2 flex-row flex-wrap">
            {stories.map((s) => (
              <View key={s.id} className={cn(colClass, 'p-2')}>
                <StoryCard
                  story={s}
                  onOpen={() => recordAction('Open', s.id)}
                  onToggleFavorite={() => updateStory(s.id, { favorited: !s.favorited })}
                  onArchiveToggle={() => updateStory(s.id, { archived: !s.archived })}
                  onEditInfo={() => recordAction('Edit info', s.id)}
                  onDuplicate={() => recordAction('Duplicate', s.id)}
                  onExport={() => recordAction('Export', s.id)}
                  onDelete={() => recordAction('Delete', s.id)}
                />
              </View>
            ))}
          </View>
        </View>

        <View className="gap-3">
          <Heading level={2}>Single column (mobile)</Heading>
          <Text size="sm" variant="muted">
            Card stretches to fill viewport on phone via grid&apos;s auto-fill min-280px.
          </Text>
          <View style={{ maxWidth: 380 }}>
            <StoryCard
              story={SAMPLE_STORIES[0]!}
              onOpen={() => recordAction('Open', SAMPLE_STORIES[0]!.id)}
              onToggleFavorite={() => {}}
              onArchiveToggle={() => {}}
              onEditInfo={() => {}}
              onDuplicate={() => {}}
              onExport={() => {}}
              onDelete={() => {}}
            />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
