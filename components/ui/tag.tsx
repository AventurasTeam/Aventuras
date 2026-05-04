import { Icon } from '@/components/ui/icon'
import { Text, TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react-native'
import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'

type TagProps = {
  /**
   * `default` = outline only. `soft` adds a `bg-region` background
   * tint, used for inline entity references (`@kael` style).
   */
  tone?: 'default' | 'soft'
  /**
   * Replaces the solid border with a dashed border. Used for
   * add-affordance buttons ("+ tag", "+ relationship").
   * Mutually-exclusive with `removable` in practice (add vs. remove
   * are different use cases).
   */
  dashed?: boolean
  /**
   * When true, renders an inline × button after the label that calls
   * `onRemove` when pressed. The × is its own touch target (44px
   * floor on phone).
   */
  removable?: boolean
  onRemove?: () => void
  /** Optional press handler on the tag body itself (clickable label). */
  onPress?: () => void
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}

export function Tag({
  tone = 'default',
  dashed,
  removable,
  onRemove,
  onPress,
  disabled,
  className,
  children,
}: TagProps) {
  const interactive = onPress != null
  const baseClass = cn(
    'flex-row items-center gap-1 rounded-full border px-2.5 py-0.5',
    'border-border-strong',
    tone === 'soft' ? 'bg-bg-region' : 'bg-bg-base',
    dashed && 'border-dashed',
    Platform.select({
      web: cn(
        interactive && 'cursor-pointer outline-none transition-colors',
        interactive && 'hover:text-fg-primary',
        interactive && 'focus-visible:ring-2 focus-visible:ring-focus-ring',
        disabled && 'cursor-not-allowed',
      ),
    }),
    disabled && 'opacity-50',
    className,
  )

  const labelClass = 'text-xs text-fg-muted'

  const label =
    typeof children === 'string' ? (
      <Text size="xs" variant="muted">
        {children}
      </Text>
    ) : (
      <TextClassContext.Provider value={labelClass}>{children}</TextClassContext.Provider>
    )

  const removeButton = removable ? (
    <Pressable
      role="button"
      accessibilityRole="button"
      aria-label="Remove"
      onPress={onRemove}
      disabled={disabled}
      // Keep × reachable as its own touch target without bloating
      // the chip body. min-w/min-h-touch-floor provides the 44px
      // tap area on phone via hitSlop without affecting layout.
      hitSlop={8}
      className={cn(
        '-mr-1 ml-0.5 size-5 items-center justify-center rounded-full',
        Platform.select({
          web: 'cursor-pointer text-fg-muted outline-none hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-focus-ring',
        }),
      )}
    >
      <Icon as={X} size={12} className="text-fg-muted" />
    </Pressable>
  ) : null

  const inner = (
    <>
      {label}
      {removeButton}
    </>
  )

  if (!interactive) {
    return <View className={baseClass}>{inner}</View>
  }

  return (
    <Pressable
      role="button"
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={baseClass}
    >
      {inner}
    </Pressable>
  )
}

export type { TagProps }
