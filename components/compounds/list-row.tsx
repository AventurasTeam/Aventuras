import { type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type RecentlyClassified = 'fresh' | 'fading'

type ListRowProps = {
  /** Primary text — entity name, thread title, happening summary. */
  label: string
  /**
   * Optional secondary line below the label — short blurb,
   * description, role label. Truncates to two lines when long.
   */
  description?: string
  /**
   * Slot before the label
   */
  leading?: ReactNode
  /**
   * Inline-after-label slot
   */
  meta?: ReactNode
  /**
   * Trailing-edge slot
   */
  trailing?: ReactNode
  /**
   * Scene-presence channel — 3 px green left-edge stripe.
   */
  inScene?: boolean
  /**
   * Recently-classified channel — info-blue background tint.
   * `'fresh'` is the just-touched state; `'fading'` decays it via
   * reduced opacity.
   */
  recentlyClassified?: RecentlyClassified
  /**
   * Master-detail selection state. Surfaces a depressed-surface
   * background to indicate the current row. Recently-classified
   * outranks selection when both fire — transient signal beats
   * persistent.
   */
  selected?: boolean
  onPress?: () => void
  disabled?: boolean
  className?: string
}

export function ListRow({
  label,
  description,
  leading,
  meta,
  trailing,
  inScene,
  recentlyClassified,
  selected,
  onPress,
  disabled,
  className,
}: ListRowProps) {
  const interactive = !disabled && onPress != null
  return (
    <Pressable
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      aria-label={label}
      aria-selected={selected}
      className={cn(
        'relative flex-row items-center gap-3 px-row-x-md py-row-y-md',
        selected && 'bg-bg-sunken',
        recentlyClassified === 'fresh' && 'bg-recently-classified-bg',
        interactive && 'active:bg-tint-press',
        Platform.select({ web: interactive ? 'cursor-pointer hover:bg-tint-hover' : '' }),
        disabled && 'opacity-50',
        Platform.select({ web: disabled && 'cursor-not-allowed' }),
        className,
      )}
    >
      {recentlyClassified === 'fading' ? (
        <View
          className="absolute inset-0 bg-recently-classified-bg opacity-50"
          aria-hidden
          pointerEvents="none"
        />
      ) : null}
      {inScene ? (
        <View
          className="absolute bottom-0 left-0 top-0 w-[3px] bg-success"
          aria-hidden
          pointerEvents="none"
        />
      ) : null}
      {selected ? (
        <View
          className="absolute bottom-0 right-0 top-0 w-[3px] bg-accent"
          aria-hidden
          pointerEvents="none"
        />
      ) : null}

      {leading != null ? <View className="shrink-0">{leading}</View> : null}

      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="shrink font-medium" numberOfLines={1}>
            {label}
          </Text>
          {meta}
        </View>
        {description != null ? (
          <Text variant="muted" size="sm" numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>

      {trailing != null ? <View className="shrink-0">{trailing}</View> : null}
    </Pressable>
  )
}

export type { ListRowProps, RecentlyClassified }
