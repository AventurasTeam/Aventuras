import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react-native'
import { useMemo, type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import type { EntryMetadata, SuggestionCategory } from '@/lib/db'
import { t } from '@/lib/i18n'
import { resolveAccentColor, useTheme } from '@/lib/themes'
import { cn } from '@/lib/utils'

/** Derived from the persisted metadata so the strip can't drift from the schema. */
type SuggestionChip = NonNullable<EntryMetadata['nextTurnSuggestions']>['items'][number]

/**
 * Two of canon's six states are absent by design: `hidden`
 * (`settings.suggestionsEnabled = false`) means the strip never mounts, which the
 * route owns by not rendering it, and `collapsed` is an orthogonal prop because
 * the chrome row survives collapse — so a refresh fired while collapsed has to
 * stay representable.
 */
type SuggestionStripPhase = 'visible' | 'loading' | 'error' | 'empty-state'

type SuggestionStripProps = {
  phase: SuggestionStripPhase
  /** Hides the body only; the chrome row and its busy signal persist. */
  collapsed: boolean
  /** Chips as persisted. A `categoryId` that no longer resolves still renders and still taps. */
  chips: readonly SuggestionChip[]
  /** The story's palette, including `enabled: false` entries — disable gates emission, not render. */
  categories: readonly SuggestionCategory[]
  /** Receives the chip's prose; the route fills the composer and forces `Free` mode. */
  onTapChip: (text: string) => void
  onRefresh: () => void
  /** Aborts the in-flight refresh. Only reachable while `phase === 'loading'`. */
  onCancel: () => void
  onToggleCollapsed: () => void
  /** The reader's edit gate is held: blocks chip taps and refresh, never collapse or cancel. */
  disabled?: boolean
  className?: string
  /** Inner measure. The band (border + surface) stays full-bleed; only the content is constrained. */
  contentClassName?: string
}

// The overline sits on the chip surface, so the tint has to carry further on dark.
const OVERLINE_TINT_ALPHA: Record<'light' | 'dark', number> = { light: 0.14, dark: 0.26 }

// Style-level, not the deprecated `pointerEvents` prop. The chips underneath
// already refuse taps via `locked`; the overlay must not become the thing that
// swallows them once the run settles.
const POINTER_EVENTS_NONE = { pointerEvents: 'none' as const }

function tintOf(hex: string, alpha: number): string {
  const body = hex.slice(1)
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body
  const n = Number.parseInt(full, 16)
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`
}

function SuggestionChipRow({
  chip,
  category,
  tintAlpha,
  locked,
  onTapChip,
}: {
  chip: SuggestionChip
  category: SuggestionCategory | undefined
  tintAlpha: number
  locked: boolean
  onTapChip: (text: string) => void
}) {
  const label = category?.label ?? t('reader:suggestions.orphanCategory')
  const accent = resolveAccentColor(category?.color)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('reader:suggestions.chipLabel', { category: label, text: chip.text })}
      aria-label={t('reader:suggestions.chipLabel', { category: label, text: chip.text })}
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={() => onTapChip(chip.text)}
      className={cn(
        'flex-row overflow-hidden rounded-md border border-border bg-bg-raised',
        !locked && 'active:bg-tint-press',
        Platform.select({
          web: cn(
            'outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
            !locked && 'cursor-pointer transition-colors hover:bg-tint-hover',
          ),
        }),
      )}
    >
      <View className="w-1 self-stretch" style={{ backgroundColor: accent }} />
      <View className="min-w-0 flex-1 gap-1 px-3 py-2">
        <View
          className="self-start rounded-sm px-1.5 py-0.5"
          style={{ backgroundColor: tintOf(accent, tintAlpha) }}
        >
          <Text size="xs" className="font-semibold uppercase tracking-wider">
            {label}
          </Text>
        </View>
        <Text size="sm">{chip.text}</Text>
      </View>
    </Pressable>
  )
}

export function SuggestionStrip({
  phase,
  collapsed,
  chips,
  categories,
  onTapChip,
  onRefresh,
  onCancel,
  onToggleCollapsed,
  disabled = false,
  className,
  contentClassName,
}: SuggestionStripProps) {
  const { theme } = useTheme()
  const tintAlpha = OVERLINE_TINT_ALPHA[theme.mode]

  // Map, not a plain object: a stored categoryId of 'constructor' must miss.
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )

  const busy = phase === 'loading'
  const locked = busy || disabled
  // The body's Generate button IS the refresh affordance; two ⟳ one above the
  // other read as different actions. Collapsing hides it, so the chrome one
  // comes back.
  const emptyStateOwnsRefresh = phase === 'empty-state' && !collapsed

  let body: ReactNode
  if (collapsed) {
    body = null
  } else if (phase === 'error') {
    body = (
      <View className="flex-row items-center gap-2 rounded-md border border-dashed border-warning px-3 py-2">
        <Icon as={AlertTriangle} size="sm" className="shrink-0 text-warning" />
        <Text size="sm" variant="muted" className="min-w-0 flex-1">
          {t('reader:suggestions.errorBody')}
        </Text>
        <Button variant="secondary" size="sm" onPress={onRefresh} disabled={locked}>
          <Icon as={RefreshCw} size="sm" />
          <Text>{t('reader:suggestions.retry')}</Text>
        </Button>
      </View>
    )
  } else if (phase === 'empty-state') {
    body = (
      <View className="items-center">
        <Button variant="ghost" size="sm" onPress={onRefresh} disabled={locked}>
          <Icon as={RefreshCw} size="sm" />
          <Text>{t('reader:suggestions.generate')}</Text>
        </Button>
      </View>
    )
  } else if (busy && chips.length === 0) {
    body = (
      <View className="flex-row items-center justify-center gap-2 py-3">
        <Spinner size="sm" colorSlot="--fg-muted" />
        <Text size="sm" variant="muted">
          {t('reader:suggestions.loading')}
        </Text>
      </View>
    )
  } else {
    body = (
      // The spinner rides over the outgoing chips rather than replacing them:
      // a re-roll that lands on nothing usable keeps what was there, so
      // clearing the stack first would flash a loss that may not happen.
      <View>
        <View className={cn('gap-1.5', locked && 'opacity-50')}>
          {chips.map((chip, index) => (
            <SuggestionChipRow
              key={index}
              chip={chip}
              category={categoryById.get(chip.categoryId)}
              tintAlpha={tintAlpha}
              locked={locked}
              onTapChip={onTapChip}
            />
          ))}
        </View>
        {busy ? (
          <View
            style={POINTER_EVENTS_NONE}
            className="absolute inset-0 items-center justify-center"
          >
            <Spinner size="lg" colorSlot="--accent" />
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View
      aria-busy={busy}
      accessibilityState={{ busy }}
      className={cn('border-t border-border bg-bg-sunken px-4 py-2', className)}
    >
      <View className={cn('gap-1.5', contentClassName)}>
        <View className="flex-row items-center justify-end gap-1">
          {busy ? (
            // Swaps in rather than sitting beside ⟳: a live refresh button next
            // to a cancel offers a re-roll the pipeline would self-block anyway.
            // Not pulsed — a throbbing control reads as busy, not as pressable,
            // and the body's dimmed chips already carry the in-flight signal.
            <IconAction
              icon={X}
              label={t('reader:suggestions.cancel')}
              size="sm"
              onPress={onCancel}
            />
          ) : emptyStateOwnsRefresh ? null : (
            <IconAction
              icon={RefreshCw}
              label={t('reader:suggestions.refresh')}
              size="sm"
              disabled={locked}
              onPress={onRefresh}
            />
          )}
          <IconAction
            icon={collapsed ? ChevronUp : ChevronDown}
            label={collapsed ? t('reader:suggestions.expand') : t('reader:suggestions.collapse')}
            size="sm"
            aria-expanded={!collapsed}
            onPress={onToggleCollapsed}
          />
        </View>
        {body}
      </View>
    </View>
  )
}

export type { SuggestionChip, SuggestionStripPhase, SuggestionStripProps }
