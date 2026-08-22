import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react-native'
import { useMemo, useState, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Spinner, SPINNER_PX } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import type { EntryMetadata, SuggestionCategory } from '@/lib/db'
import { t } from '@/lib/i18n'
import { resolveAccentColor, useTheme, type AccentHex } from '@/lib/themes'
import { cn } from '@/lib/utils'

/** Derived from the persisted metadata so the strip can't drift from the schema. */
type SuggestionChip = NonNullable<EntryMetadata['nextTurnSuggestions']>['items'][number]

/**
 * Canon's six states, minus three that are not this prop's business. `hidden`
 * (`settings.suggestionsEnabled = false`) means the strip never mounts, which
 * the route owns by not rendering it. `collapsed` is an orthogonal prop because
 * the chrome row survives collapse — so a refresh fired while collapsed stays
 * representable. And `visible` vs `empty-state` is not a phase at all: it is
 * `chips.length`, which this component already receives, so carrying it here
 * too would make `visible`-with-no-chips and `empty-state`-with-chips
 * representable, and both render wrong.
 */
type SuggestionStripPhase = 'idle' | 'loading' | 'error'

type SuggestionStripProps = {
  phase: SuggestionStripPhase
  /** Hides the body only; the chrome row and its busy signal persist. */
  collapsed: boolean
  /** Chips as persisted. A `categoryId` that no longer resolves still renders and still taps. */
  chips: readonly SuggestionChip[]
  /** The story's palette, including `enabled: false` entries — disable gates emission, not render. */
  categories: readonly SuggestionCategory[]
  /** Resolved by the route from the run's `PipelineError`; the strip never classifies a failure. */
  errorMessage?: string
  /** Set only for deterministic failures — replaces Retry, which could not succeed. */
  errorFix?: { label: string; onPress: () => void }
  /** False when no category is enabled: the phase would no-op, so ⟳ must not offer the run. */
  canRefresh?: boolean
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

// One single-line chip row, from the markup in SuggestionChipRow below: 2px
// borders + 16px (py-2) + a 20px overline (4px py-0.5 over a 16px text-xs
// line) + 4px (gap-1) + a 20px text-sm line. An upper bound on the overlay
// spinner only — never an assumed row height, since a wrapped chip is taller.
const CHIP_ROW_PX = 62

// Share of the viewport the chip stack may occupy before it scrolls. The strip
// sits above the composer in a non-scrolling column, so an uncapped stack
// pushes the input off screen with no way back except the collapse chevron.
const MAX_STACK_VIEWPORT_FRACTION = 0.38

// 1.5 rows, but never taller than the stack it covers: the overlay is
// positioned rather than clipped, so over one short chip the untrimmed size
// would spill onto the chrome row above and the composer below. Driven by the
// measured stack rather than a per-count estimate — chips wrap, so any
// computed height would drift from the real one.
function overlaySpinnerPx(stackPx: number): number {
  return Math.max(SPINNER_PX.lg, Math.min(Math.round(CHIP_ROW_PX * 1.5), stackPx - 12))
}

function tintOf(hex: AccentHex, alpha: number): string {
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
  errorMessage,
  errorFix,
  canRefresh = true,
  disabled = false,
  className,
  contentClassName,
}: SuggestionStripProps) {
  const { theme } = useTheme()
  const tintAlpha = OVERLINE_TINT_ALPHA[theme.mode]
  const { height: windowHeight } = useWindowDimensions()
  const maxStackPx = Math.round(windowHeight * MAX_STACK_VIEWPORT_FRACTION)
  // Measured, not derived: the overlay spinner has to fit the stack as rendered,
  // and a wrapped chip makes any arithmetic estimate wrong.
  const [stackPx, setStackPx] = useState(0)

  // Map, not a plain object: a stored categoryId of 'constructor' must miss.
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )

  const busy = phase === 'loading'
  // A foreign lock (a turn in flight) is treated exactly as our own refresh is:
  // taps refuse and the overlay spinner shows, because whatever is on screen is
  // about to be replaced and a static stack reads as interactive-but-broken. It
  // deliberately does NOT get the "Generating suggestions…" line or the ✕ — the
  // route cannot know this turn will emit chips at all (zero enabled categories
  // or capability gating can skip it silently), and the turn's cancel lives on
  // the composer.
  const locked = busy || disabled
  const refreshBlocked = locked || !canRefresh
  // Exactly the condition under which the body below renders ⟳ Generate. That
  // button IS the refresh affordance, and two ⟳ one above the other read as
  // different actions — but every other chipless case (collapsed, busy,
  // turn-locked) shows no Generate, so the chrome one has to come back or the
  // strip has no ⟳ anywhere.
  const bodyOwnsRefresh = !collapsed && phase === 'idle' && !disabled && chips.length === 0

  const chipStack = (
    <ScrollView
      style={{ maxHeight: maxStackPx }}
      className={cn(locked && 'opacity-50')}
      contentContainerClassName="gap-1.5"
      showsVerticalScrollIndicator={false}
      onLayout={(e) => setStackPx(e.nativeEvent.layout.height)}
    >
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
    </ScrollView>
  )

  let body: ReactNode
  if (collapsed) {
    body = null
  } else if (phase === 'error') {
    body = (
      <View className="gap-1.5">
        <View className="flex-row items-center gap-2 rounded-md border border-dashed border-warning px-3 py-2">
          <Icon as={AlertTriangle} size="sm" className="shrink-0 text-warning" />
          <Text size="sm" variant="muted" className="min-w-0 flex-1">
            {errorMessage ?? t('reader:suggestions.errorBody')}
          </Text>
          {errorFix ? (
            // A deterministic failure (no profile assigned, profile or provider
            // missing) cannot be retried into success, so the only honest
            // control is the one that goes and fixes it.
            <Button variant="secondary" size="sm" onPress={errorFix.onPress}>
              <Text>{errorFix.label}</Text>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onPress={onRefresh} disabled={refreshBlocked}>
              <Icon as={RefreshCw} size="sm" />
              <Text>{t('reader:suggestions.retry')}</Text>
            </Button>
          )}
        </View>
        {/* A failed re-roll must not destroy what was on screen: these chips
            predate the failure and stay tappable. Same contract the loading
            overlay honours. */}
        {chips.length > 0 ? chipStack : null}
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
  } else if (disabled && chips.length === 0) {
    // Ahead of the empty-state branch on purpose: a turn in flight would
    // otherwise leave a dead ⟳ Generate offering to generate the very thing
    // the running turn produces. The spinner alone waits without claiming
    // chips are coming.
    body = (
      <View className="items-center py-3">
        <Spinner size="md" colorSlot="--fg-muted" />
      </View>
    )
  } else if (chips.length === 0) {
    // Canon's empty-state. Derived from the chips rather than announced by the
    // route: the two cannot disagree if only one of them exists.
    body = (
      <View className="items-center">
        <Button variant="ghost" size="sm" onPress={onRefresh} disabled={refreshBlocked}>
          <Icon as={RefreshCw} size="sm" />
          <Text>{t('reader:suggestions.generate')}</Text>
        </Button>
      </View>
    )
  } else {
    body = (
      // The spinner rides over the outgoing chips rather than replacing them:
      // a re-roll that lands on nothing usable keeps what was there, so
      // clearing the stack first would flash a loss that may not happen.
      <View>
        {chipStack}
        {/* Inert on purpose: the chips underneath already refuse taps while locked,
            so the scrim must not become the thing that swallows them. */}
        {locked ? (
          <View
            style={POINTER_EVENTS_NONE}
            className="absolute inset-0 items-center justify-center"
          >
            <Spinner size={overlaySpinnerPx(stackPx)} colorSlot="--accent" />
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
        <View className="flex-row items-center justify-between gap-2">
          {/* Collapsed, the chrome row is the only thing left — without a label
              it is two bare icons floating above the composer. */}
          <Text size="xs" variant="muted" className="font-semibold uppercase tracking-wider">
            {t('reader:suggestions.title')}
          </Text>
          <View className="flex-row items-center gap-1">
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
            ) : bodyOwnsRefresh ? null : (
              <IconAction
                icon={RefreshCw}
                label={t('reader:suggestions.refresh')}
                size="sm"
                disabled={refreshBlocked}
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
        </View>
        {body}
      </View>
    </View>
  )
}

export type { SuggestionChip, SuggestionStripPhase, SuggestionStripProps }
