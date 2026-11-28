import { Star } from 'lucide-react-native'
import { Platform, Pressable, View } from 'react-native'

import { OverflowMenu, type OverflowMenuEntry } from '@/components/compounds/overflow-menu'
import { Chip } from '@/components/ui/chip'
import { Icon } from '@/components/ui/icon'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_BOX_NONE, POINTER_EVENTS_NONE } from '@/constants/styles'
import { type StoryDefinition } from '@/lib/db'
import { t } from '@/lib/i18n'
import { type OpenFailureKind, type StoryCardData } from '@/lib/stores'
import { cn } from '@/lib/utils'

type StoryMode = StoryDefinition['mode']

type StoryCardProps = {
  story: StoryCardData
  openFailure?: OpenFailureKind
  onOpen: () => void
  onToggleFavorite: () => void
  onArchiveToggle: () => void
  onEditInfo?: () => void
  onDuplicate?: () => void
  onExport?: () => void
  onDelete: () => void
  className?: string
}

export const MODE_DEFAULT_COLOR: Record<StoryMode, string> = {
  adventure: '#3b82f6',
  creative: '#a855f7',
}

const MODE_LABEL_KEY = {
  adventure: 'storyCard.modeAdventure',
  creative: 'storyCard.modeCreative',
} as const satisfies Record<StoryMode, string>

const OPEN_FAILURE_LABEL_KEY = {
  'definition-corrupt': 'storyCard.definitionCorrupt',
  'settings-corrupt': 'storyCard.settingsCorrupt',
} as const satisfies Record<OpenFailureKind, string>

export function StoryCard({
  story,
  openFailure,
  onOpen,
  onToggleFavorite,
  onArchiveToggle,
  onEditInfo,
  onDuplicate,
  onExport,
  onDelete,
  className,
}: StoryCardProps) {
  // Drafts carry a partial/null `definition` that fails strict storyDefinitionSchema;
  // the card only needs mode + genre.label, so read through a loose cast.
  const def = (story.definition ?? null) as {
    mode?: StoryMode
    genre?: { label?: string | null } | null
  } | null
  const genreLabel = def?.genre?.label ?? null
  // The loose cast can't vouch for the value; a corrupt/partial draft may carry a stray `mode`
  // that would miss the MODE_* lookups below. Re-validate against the known keys.
  const mode: StoryMode =
    def?.mode != null && def.mode in MODE_DEFAULT_COLOR ? def.mode : 'creative'
  const favorited = story.favorite === 1
  const archived = story.status === 'archived'
  const isDraft = story.status === 'draft'

  const stripColor = story.accentColor ?? MODE_DEFAULT_COLOR[mode]
  // Duplicate and Delete open a dialog: on phone they wait out the menu Sheet's exit.
  const overflowEntries: OverflowMenuEntry[] = [
    ...(isDraft
      ? []
      : [
          {
            key: 'archive',
            label: archived ? t('storyCard.unarchive') : t('storyCard.archive'),
            onPress: onArchiveToggle,
          },
        ]),
    ...(onEditInfo
      ? [{ key: 'edit-info', label: t('storyCard.editInfo'), onPress: onEditInfo }]
      : []),
    ...(onDuplicate
      ? [
          {
            key: 'duplicate',
            label: t('storyCard.duplicate'),
            opensSheet: true,
            onPress: onDuplicate,
          },
        ]
      : []),
    ...(onExport ? [{ key: 'export', label: t('storyCard.export'), onPress: onExport }] : []),
    {
      key: 'delete',
      label: t('storyCard.delete'),
      destructive: true,
      opensSheet: true,
      onPress: onDelete,
    },
  ]

  const modeLabel = t(MODE_LABEL_KEY[mode])
  const failureLabel = openFailure ? t(OPEN_FAILURE_LABEL_KEY[openFailure]) : null
  const metaParts = [modeLabel, story.chapterLabel, story.lastOpenedRelative].filter(
    (part): part is string => part != null,
  )

  return (
    <View
      className={cn(
        'relative w-full overflow-hidden rounded-lg border border-border bg-bg-base',
        Platform.select({ web: 'h-full' }),
        archived && 'opacity-55',
        className,
      )}
    >
      <View
        className="absolute bottom-0 left-0 top-0 w-1"
        style={[{ backgroundColor: stripColor }, POINTER_EVENTS_NONE]}
        aria-hidden
      />

      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={
          failureLabel
            ? t('storyCard.openWithFailure', { title: story.title, failure: failureLabel })
            : t('storyCard.open', { title: story.title })
        }
        className={cn(
          'flex-1 flex-col gap-1.5 p-4 pl-5',
          'active:bg-tint-press',
          Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
        )}
      >
        {genreLabel != null ? (
          <Text
            size="xs"
            className="font-medium uppercase tracking-wide"
            style={{ color: stripColor }}
            numberOfLines={1}
          >
            {genreLabel}
          </Text>
        ) : (
          <Text
            size="xs"
            variant="muted"
            className="font-medium uppercase tracking-wide"
            numberOfLines={1}
          >
            {t('storyCard.genreNotSet')}
          </Text>
        )}

        <View className="mt-1 flex-row items-start gap-2 pl-7">
          <Text className="flex-1 font-medium" numberOfLines={2}>
            {story.title}
          </Text>

          {isDraft ? <Chip>{t('storyCard.draft')}</Chip> : null}
          {archived ? <Chip>{t('storyCard.archived')}</Chip> : null}
        </View>

        <Text size="xs" variant="muted" numberOfLines={1}>
          {metaParts.join(' · ')}
        </Text>

        {failureLabel ? (
          <Tag tone="danger" className="max-w-full self-start rounded-md">
            <Text size="xs" numberOfLines={2}>
              {failureLabel}
            </Text>
          </Tag>
        ) : null}

        <Text
          size="sm"
          numberOfLines={3}
          className={story.description == null ? 'italic text-fg-muted' : ''}
        >
          {story.description ?? t('storyCard.noDescription')}
        </Text>
      </Pressable>

      <Pressable
        onPress={onToggleFavorite}
        accessibilityRole="button"
        accessibilityLabel={favorited ? t('storyCard.unfavorite') : t('storyCard.favorite')}
        hitSlop={8}
        className={cn(
          'group/star absolute left-[22px] top-[40px] rounded-sm',
          Platform.select({ web: 'cursor-pointer outline-none' }),
        )}
      >
        <Icon
          as={Star}
          size="sm"
          className={cn(
            favorited
              ? 'fill-warning text-warning'
              : cn(
                  'text-fg-muted',
                  Platform.select({
                    web: 'group-hover/star:text-fg-primary group-focus-visible/star:text-fg-primary',
                  }),
                ),
          )}
        />
      </Pressable>

      <View className="absolute right-2 top-2" style={POINTER_EVENTS_BOX_NONE}>
        <OverflowMenu label={t('storyCard.actionsLabel')} entries={overflowEntries} />
      </View>
    </View>
  )
}

export type { StoryCardProps, StoryMode }
