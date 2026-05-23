import { MoreHorizontal, Star } from 'lucide-react-native'
import { useRef, type ComponentRef } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Chip } from '@/components/ui/chip'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type StoryMode = 'adventure' | 'creative'

type Story = {
  id: string
  title: string
  description: string | null
  /** From `definition.genre.label`. Renders as the uppercase overline. */
  genreLabel: string | null
  mode: StoryMode
  /**
   * `stories.accent_color` override. When null, falls back to the
   * mode-derived default. Compound owns the mode→color mapping
   * because no canonical constant exists yet (followup tracks
   * pinning these to themed tokens).
   */
  accentColor: string | null
  favorited: boolean
  archived: boolean
  /** Unfinished wizard session or explicit save-as-draft. */
  isDraft: boolean
  /** Pre-formatted "Chapter 3"; null on drafts (host responsibility). */
  chapterLabel: string | null
  /** Pre-formatted "2h ago" — same opaque contract as DeltaLogRow's createdAtRelative. */
  lastOpenedRelative: string
}

type StoryCardProps = {
  story: Story
  onOpen: () => void
  onToggleFavorite: () => void
  onArchiveToggle: () => void
  onEditInfo: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void
  className?: string
}

const MODE_DEFAULT_COLOR: Record<StoryMode, string> = {
  adventure: '#3b82f6',
  creative: '#a855f7',
}

const MODE_LABEL: Record<StoryMode, string> = {
  adventure: 'Adventure',
  creative: 'Creative',
}

export function StoryCard({
  story,
  onOpen,
  onToggleFavorite,
  onArchiveToggle,
  onEditInfo,
  onDuplicate,
  onExport,
  onDelete,
  className,
}: StoryCardProps) {
  const stripColor = story.accentColor ?? MODE_DEFAULT_COLOR[story.mode]
  const overflowTriggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)

  const metaParts = [MODE_LABEL[story.mode], story.chapterLabel, story.lastOpenedRelative].filter(
    (part): part is string => part != null,
  )

  return (
    <View
      className={cn(
        'relative w-full overflow-hidden rounded-lg border border-border bg-bg-base',
        Platform.select({ web: 'h-full' }),
        story.archived && 'opacity-55',
        className,
      )}
    >
      <View
        className="absolute bottom-0 left-0 top-0 w-1"
        style={{ backgroundColor: stripColor }}
        aria-hidden
        pointerEvents="none"
      />

      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${story.title}`}
        className={cn(
          'flex-1 flex-col gap-1.5 p-4 pl-5',
          'active:bg-tint-press',
          Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
        )}
      >
        {story.genreLabel != null ? (
          <Text
            size="xs"
            className="font-medium uppercase tracking-wide"
            style={{ color: stripColor }}
            numberOfLines={1}
          >
            {story.genreLabel}
          </Text>
        ) : (
          <Text
            size="xs"
            variant="muted"
            className="font-medium uppercase tracking-wide"
            numberOfLines={1}
          >
            Genre not set
          </Text>
        )}

        <View className="mt-1 flex-row items-start gap-2 pl-7">
          <Text className="flex-1 font-medium" numberOfLines={2}>
            {story.title}
          </Text>

          {story.isDraft ? <Chip>Draft</Chip> : null}
          {story.archived ? <Chip>Archived</Chip> : null}
        </View>

        <Text size="xs" variant="muted" numberOfLines={1}>
          {metaParts.join(' · ')}
        </Text>

        <Text
          size="sm"
          numberOfLines={3}
          className={story.description == null ? 'italic text-fg-muted' : ''}
        >
          {story.description ?? '(no description yet)'}
        </Text>
      </Pressable>

      <Pressable
        onPress={onToggleFavorite}
        accessibilityRole="button"
        accessibilityLabel={story.favorited ? 'Unfavorite story' : 'Favorite story'}
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
            story.favorited
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

      <View className="absolute right-2 top-2" pointerEvents="box-none">
        <Popover>
          <PopoverTrigger ref={overflowTriggerRef} asChild>
            <IconAction icon={MoreHorizontal} label="Story actions" size="sm" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <View className="flex-col">
              <OverflowItem
                label={story.archived ? 'Unarchive' : 'Archive'}
                onSelect={() => {
                  overflowTriggerRef.current?.close()
                  onArchiveToggle()
                }}
              />
              <OverflowItem
                label="Edit info"
                onSelect={() => {
                  overflowTriggerRef.current?.close()
                  onEditInfo()
                }}
              />
              <OverflowItem
                label="Duplicate"
                onSelect={() => {
                  overflowTriggerRef.current?.close()
                  onDuplicate()
                }}
              />
              <OverflowItem
                label="Export"
                onSelect={() => {
                  overflowTriggerRef.current?.close()
                  onExport()
                }}
              />
              <OverflowItem
                label="Delete"
                destructive
                onSelect={() => {
                  overflowTriggerRef.current?.close()
                  onDelete()
                }}
              />
            </View>
          </PopoverContent>
        </Popover>
      </View>
    </View>
  )
}

function OverflowItem({
  label,
  destructive,
  onSelect,
}: {
  label: string
  destructive?: boolean
  onSelect: () => void
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      onPress={onSelect}
      className={cn(
        'justify-center rounded-sm px-row-x-md py-row-y-sm',
        'active:bg-tint-press',
        Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
      )}
    >
      <Text size="sm" className={cn('font-medium', destructive && 'text-danger')}>
        {label}
      </Text>
    </Pressable>
  )
}

export type { Story, StoryCardProps, StoryMode }
