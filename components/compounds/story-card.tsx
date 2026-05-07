import { MoreHorizontal, Star } from 'lucide-react-native'
import * as React from 'react'
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

// Mode-derived strip colors. Pinned hex because no canonical token
// exists yet — pattern doc just describes "Adventure blue, Creative
// purple". When the visual identity session lands proper tokens,
// these become CSS-var references. Followup: see followups.md for
// the broader color-token consolidation effort.
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
  const overflowTriggerRef = React.useRef<React.ComponentRef<typeof PopoverTrigger>>(null)

  const metaParts = [MODE_LABEL[story.mode], story.chapterLabel, story.lastOpenedRelative].filter(
    (part): part is string => part != null,
  )

  return (
    <View
      className={cn(
        // Web-only `h-full` so a flex-row flex-wrap parent stretches
        // the card to match the tallest in the row (CSS percentage
        // heights resolve cleanly through `align-items: stretch`).
        // On native, RN Yoga's percentage-height resolution against
        // implicit parent heights (computed via stretch, inside an
        // unbounded ScrollView) feedback-loops into runaway height.
        // Native cards size to content; equal-row-height returns
        // when the production Story List uses `FlatList numColumns`
        // which manages row heights explicitly.
        'relative w-full overflow-hidden rounded-lg border border-border bg-bg-base',
        Platform.select({ web: 'h-full' }),
        // Archived dims the entire card. opacity is the spec'd
        // signal here (vs color tiers used elsewhere) — applies
        // uniformly to text + chips + strip without per-element
        // overrides. Card body click still opens the story.
        story.archived && 'opacity-55',
        className,
      )}
    >
      {/* Left-edge accent strip — 4 px, full-height, color-keyed.
          Pinned via inline style because the color value comes from
          arbitrary `accent_color` overrides + mode-default hex; no
          Tailwind class would cover the open palette. */}
      <View
        className="absolute bottom-0 left-0 top-0 w-1"
        style={{ backgroundColor: stripColor }}
        aria-hidden
        pointerEvents="none"
      />

      {/* Body Pressable — covers card body. Star and overflow live
          OUTSIDE this Pressable as siblings so RN-Web doesn't
          render <button> nested in <button>. Per pattern doc:
          "card-body Pressable wraps ONLY the body region (overline
          + title row + meta + description), not the absolute-
          positioned star or ⋯." Title row reserves a left column
          via `pl-7` for the absolute-overlaid star. */}
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${story.title}`}
        className={cn(
          // flex-1 so the body fills card-root's height — without
          // it, short-content cards leave a hover-dead strip at the
          // bottom because the grid stretches the card-root via
          // h-full but the body shrinks to its content. The hover
          // tint follows the body's bounds, so a flex-1 body =
          // hover covers the whole card body.
          'flex-1 flex-col gap-1.5 p-4 pl-5',
          'active:bg-tint-press',
          Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
        )}
      >
        {/* Genre overline. Sits on its own line to leave room for
            the absolute overflow trigger top-right. Color matches
            the strip when set — accent overline reads as part of
            the same color channel. Placeholder falls back to muted
            so a missing genre doesn't get visual emphasis it
            doesn't earn. */}
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

        {/* Title row — left column reserved for absolute-positioned
            star (sibling, not descendant). pl-7 ≈ 28 px = 16 px star
            footprint + 12 px breathing room. */}
        <View className="mt-1 flex-row items-start gap-2 pl-7">
          <Text className="flex-1 font-medium" numberOfLines={2}>
            {story.title}
          </Text>

          {/* Status chips — non-interactive (no `onPress`). Both
              can co-exist; `Draft` wins reading order when both
              fire. */}
          {story.isDraft ? <Chip>Draft</Chip> : null}
          {story.archived ? <Chip>Archived</Chip> : null}
        </View>

        {/* Meta row — Mode · Chapter · LastOpened. Chapter omitted
            for drafts (the host passes null); join handles it. */}
        <Text size="xs" variant="muted" numberOfLines={1}>
          {metaParts.join(' · ')}
        </Text>

        {/* Description — 3-line ellipsis. Italic placeholder when
            null, matching the spec's `(no description yet)`. */}
        <Text
          size="sm"
          numberOfLines={3}
          className={story.description == null ? 'italic text-fg-muted' : ''}
        >
          {story.description ?? '(no description yet)'}
        </Text>
      </Pressable>

      {/* Favorite star — absolute, anchored to card root. Sibling
          of the body Pressable (not descendant) to avoid nested
          <button> on RN-Web. Position aligns with the title row's
          first-line baseline; coordinates are pixel-pinned because
          they're driven by:
            top  = body p-4 (16) + overline xs line-height (~16) +
                   mt-1 (4) + visual centering offset (~4) ≈ 40 px
            left = body pl-5 (20) + small offset ≈ 22 px
          Brittle to overline line-count or font-size changes; the
          title row reserves `pl-7` so the visible footprint stays
          clear regardless. */}
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
        {/* Color-tier visibility (NOT opacity-tier) — pattern doc
            uses opacity in its rest/hover table, but cssInterop
            strips opacity into a style prop that doesn't compose
            with `hover:` modifiers on RN-Web (same trap icon-actions
            hit). Color tiers deliver the same visual hierarchy. */}
        <Icon
          as={Star}
          size="sm"
          fill={story.favorited ? 'currentColor' : 'none'}
          className={cn(
            story.favorited
              ? 'text-warning'
              : cn(
                  'text-fg-muted',
                  Platform.select({
                    web: 'group-hover/star:text-fg-primary group-focus-visible/star:text-fg-primary',
                  }),
                ),
          )}
        />
      </Pressable>

      {/* Overflow `⋯` — absolute top-right, OUTSIDE the body
          Pressable so its tap target never bubbles into onOpen.
          Popover-only across all tiers, matching ImporterMenu
          precedent and the user's preference for not splitting
          tier-aware menu shells (Sheet branch was removed from
          Toolbar's ScopeHelp for the same reason). If phone
          ergonomics require a bottom-sheet menu later, lift here. */}
      <View
        className="absolute right-2 top-2"
        // Body Pressable's web hover-tint shouldn't fire when the
        // user hovers the overflow control. pointerEvents="box-none"
        // lets the inner trigger receive presses while the wrapper
        // itself doesn't intercept them.
        pointerEvents="box-none"
      >
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

export type { StoryCardProps, Story, StoryMode }
