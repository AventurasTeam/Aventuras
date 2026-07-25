import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react-native'
import { useEffect, useMemo, type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
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
  onToggleCollapsed: () => void
  /** In-flight per-turn generation: blocks chip taps and refresh, never collapse. */
  disabled?: boolean
  className?: string
}

// The overline sits on the chip surface, so the tint has to carry further on dark.
const OVERLINE_TINT_ALPHA: Record<'light' | 'dark', number> = { light: 0.14, dark: 0.26 }

const WEB_POINTER_EVENTS_NONE = { pointerEvents: 'none' } as const

function tintOf(hex: string, alpha: number): string {
  const body = hex.slice(1)
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body
  const n = Number.parseInt(full, 16)
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`
}

// Split like Skeleton: Tailwind's animate-pulse doesn't run on native, and
// Storybook's Vite bundler skips Reanimated's worklet plugin (Metro applies it to
// both native and the web export), where a deps-array-less useAnimatedStyle throws.
function Pulsing({ active, children }: { active: boolean; children: ReactNode }) {
  if (Platform.OS === 'web') {
    return <View className={cn(active && 'animate-pulse')}>{children}</View>
  }
  return <NativePulsing active={active}>{children}</NativePulsing>
}

function NativePulsing({ active, children }: { active: boolean; children: ReactNode }) {
  const opacity = useSharedValue(1)
  useEffect(() => {
    opacity.set(
      active
        ? withRepeat(withTiming(0.3, { duration: 600 }), -1, true)
        : withTiming(1, { duration: 150 }),
    )
  }, [active, opacity])
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }), [])
  return <Animated.View style={style}>{children}</Animated.View>
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
      // Pressable.disabled alone doesn't reliably gate the web click path.
      style={locked && Platform.OS === 'web' ? WEB_POINTER_EVENTS_NONE : undefined}
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
  onToggleCollapsed,
  disabled = false,
  className,
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
  // The body's Generate button IS the refresh affordance; two ⟳ side by side read
  // as different actions. Collapsing hides it, so the chrome one comes back.
  const showChromeRefresh = !(phase === 'empty-state' && !collapsed)

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
        <Button variant="secondary" size="sm" onPress={onRefresh} disabled={disabled}>
          <Icon as={RefreshCw} size="sm" />
          <Text>{t('reader:suggestions.retry')}</Text>
        </Button>
      </View>
    )
  } else if (phase === 'empty-state') {
    body = (
      <View className="items-center">
        <Button variant="ghost" size="sm" onPress={onRefresh} disabled={disabled}>
          <Icon as={RefreshCw} size="sm" />
          <Text>{t('reader:suggestions.generate')}</Text>
        </Button>
      </View>
    )
  } else if (busy && chips.length === 0) {
    body = (
      <View className="items-center py-2">
        <Text size="sm" variant="muted">
          {t('reader:suggestions.loading')}
        </Text>
      </View>
    )
  } else {
    body = (
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
    )
  }

  return (
    <View
      aria-busy={busy}
      accessibilityState={{ busy }}
      className={cn('gap-1.5 border-t border-border bg-bg-sunken px-4 py-2', className)}
    >
      {body}
      <View className="flex-row items-center justify-end gap-1">
        {showChromeRefresh ? (
          <Pulsing active={busy}>
            <IconAction
              icon={RefreshCw}
              label={t('reader:suggestions.refresh')}
              size="sm"
              aria-busy={busy}
              disabled={locked}
              onPress={onRefresh}
            />
          </Pulsing>
        ) : null}
        <IconAction
          icon={collapsed ? ChevronUp : ChevronDown}
          label={collapsed ? t('reader:suggestions.expand') : t('reader:suggestions.collapse')}
          size="sm"
          aria-expanded={!collapsed}
          onPress={onToggleCollapsed}
        />
      </View>
    </View>
  )
}

export type { SuggestionChip, SuggestionStripPhase, SuggestionStripProps }
