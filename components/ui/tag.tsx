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
    // `group` hooks the Pressable so the label can hover-lift via
    // group-hover through TextClassContext (direct hover: doesn't
    // cascade to inherited text colors).
    'group flex-row items-center gap-1 rounded-full border px-2.5 py-0.5',
    'border-border-strong',
    tone === 'soft' ? 'bg-bg-region' : 'bg-bg-base',
    dashed && 'border-dashed',
    interactive && 'active:bg-tint-press',
    Platform.select({
      web: cn(
        interactive && 'cursor-pointer outline-none transition-colors',
        interactive && 'hover:bg-tint-hover',
        interactive && 'focus-visible:ring-2 focus-visible:ring-focus-ring',
        disabled && 'cursor-not-allowed pointer-events-none',
      ),
    }),
    disabled && 'opacity-50',
    className,
  )

  const labelClass = cn(
    'text-xs text-fg-muted',
    interactive && Platform.select({ web: 'transition-colors group-hover:text-fg-primary' }),
  )

  const label =
    typeof children === 'string' ? (
      <Text size="xs" className={labelClass}>
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
      // the chip body. hitSlop provides the 44px tap area on phone
      // without affecting layout.
      hitSlop={8}
      // `group/x` scopes a separate group so the × hover doesn't
      // bleed into the body's group-hover (and vice versa).
      className={cn(
        'group/x -mr-1 ml-0.5 size-5 items-center justify-center rounded-full',
        Platform.select({
          web: 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        }),
      )}
    >
      <Icon
        as={X}
        size={12}
        className={cn(
          'text-fg-muted',
          Platform.select({ web: 'transition-colors group-hover/x:text-fg-primary' }),
        )}
      />
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
