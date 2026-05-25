import { X } from 'lucide-react-native'
import { type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Text, TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type TagTone = 'default' | 'soft' | 'success' | 'warning' | 'danger' | 'accent'

const TONE_CLASSES: Record<TagTone, { container: string; label: string; filled: boolean }> = {
  default: {
    container: 'border-border-strong bg-bg-base',
    label: 'text-fg-muted',
    filled: false,
  },
  soft: {
    container: 'border-border-strong bg-bg-region',
    label: 'text-fg-muted',
    filled: false,
  },
  success: {
    container: 'border-success bg-success',
    label: 'text-success-fg',
    filled: true,
  },
  warning: {
    container: 'border-warning bg-warning',
    label: 'text-warning-fg',
    filled: true,
  },
  danger: {
    container: 'border-danger bg-danger',
    label: 'text-danger-fg',
    filled: true,
  },
  accent: {
    container: 'border-accent bg-accent',
    label: 'text-accent-fg',
    filled: true,
  },
}

type TagProps = {
  /**
   * Visual tone:
   * - `default` — outline + muted text (neutral, default).
   * - `soft` — `bg-region` tint (inline entity references, tag chips).
   * - `success` — filled `bg-success` + `text-success-fg` (staged entity, Resolved thread).
   * - `warning` — filled `bg-warning` + `text-warning-fg` (retired entity, Pending thread, error-pill variant).
   * - `danger` — filled `bg-danger` + `text-danger-fg` (Failed thread).
   * - `accent` — filled `bg-accent` + `text-accent-fg` (gen pill active phase).
   */
  tone?: TagTone
  /**
   * Replaces the solid border with a dashed border.
   */
  dashed?: boolean
  /**
   * When true, renders an inline × button after the label that calls
   * `onRemove` when pressed.
   */
  removable?: boolean
  onRemove?: () => void
  /** Optional press handler on the tag body itself (clickable label). */
  onPress?: () => void
  disabled?: boolean
  className?: string
  /**
   * Optional element rendered before the label, separated by `gap-1`.
   */
  leading?: ReactNode
  children?: ReactNode
}

export function Tag({
  tone = 'default',
  dashed,
  removable,
  onRemove,
  onPress,
  disabled,
  className,
  leading,
  children,
}: TagProps) {
  const interactive = onPress != null
  const toneClasses = TONE_CLASSES[tone]
  const baseClass = cn(
    'group flex-row items-center gap-1 rounded-full border px-row-x-xs py-row-y-xs',
    toneClasses.container,
    dashed && 'border-dashed',
    interactive && (toneClasses.filled ? 'active:opacity-90' : 'active:bg-tint-press'),
    Platform.select({
      web: cn(
        interactive && 'cursor-pointer outline-none transition-colors',
        interactive && (toneClasses.filled ? 'hover:opacity-90' : 'hover:bg-tint-hover'),
        interactive && 'focus-visible:ring-2 focus-visible:ring-focus-ring',
        disabled && 'cursor-not-allowed pointer-events-none',
      ),
    }),
    disabled && 'opacity-50',
    className,
  )

  const labelClass = cn(
    'text-xs',
    toneClasses.label,
    interactive &&
      !toneClasses.filled &&
      Platform.select({ web: 'transition-colors group-hover:text-fg-primary' }),
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
      hitSlop={8}
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
      {leading}
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

export type { TagProps, TagTone }
