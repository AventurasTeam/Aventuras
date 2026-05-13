import { Icon } from '@/components/ui/icon'
import { Text, TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react-native'
import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'

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
  /**
   * Optional element rendered before the label, separated by the
   * existing `gap-1`. Used by GenerationStatusPill to inject a
   * Spinner during active phases; available to any future consumer
   * needing a small leading indicator.
   *
   * Note: Spinner / Icon children that take their own color slot
   * (not the text-color cascade) must be passed the matching slot
   * for the tone — e.g. `<Spinner size="sm" colorSlot="--accent-fg" />`
   * inside a `tone="accent"` tag.
   */
  leading?: React.ReactNode
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
  leading,
  children,
}: TagProps) {
  const interactive = onPress != null
  const toneClasses = TONE_CLASSES[tone]
  const baseClass = cn(
    // `group` hooks the Pressable so the label can hover-lift via
    // group-hover through TextClassContext (direct hover: doesn't
    // cascade to inherited text colors).
    'group flex-row items-center gap-1 rounded-full border px-row-x-xs py-row-y-xs',
    toneClasses.container,
    dashed && 'border-dashed',
    // Saturated bg surfaces absorb `bg-tint-*` overlays, so filled
    // tones need opacity-based hover/press feedback while neutral
    // tones use the state-layer tints.
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
    // `group-hover` lift only on neutral tones — filled tones already
    // saturate the foreground via `*-fg` and have no second-tier color.
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
