import { cva, type VariantProps } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react-native'
import { Platform, Pressable, type PressableProps } from 'react-native'

import { Icon, type IconSizeVariant } from '@/components/ui/icon'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

/**
 * IconAction — discrete row-action icon button.
 *
 * Per [icon-actions.md](../../docs/ui/patterns/icon-actions.md):
 * always rendered, color-tiered to read as receded-but-visible by
 * default and full-strength on hover/focus. The default brightens
 * to `fg-primary` on row (`group`) hover and on self-hover (web),
 * with self-hover additionally surfacing `bg-tint-hover`. Touch
 * sits at the receded color and taps trigger normally.
 *
 * **Color tiers, not opacity tiers.** An earlier draft used
 * opacity-based muting (per the original spec wording) — opacity
 * doesn't compose reliably with hover modifiers on RN-Web because
 * `opacity` is extracted to a style prop via cssInterop, so
 * `hover:opacity-100` never fires through CSS-driven hover state.
 * Color classes (`text-fg-secondary` / `text-fg-primary` /
 * `text-fg-muted`) work as ordinary CSS and compose cleanly with
 * `hover:` and `group-hover:` modifiers. Spec was updated to match.
 *
 * Destructive variant shifts the icon color to `text-danger` on
 * self-hover via a named group, overriding the row-hover cue.
 *
 * `disabledReason` upgrades the disabled state with a `cursor-help`
 * cue and the browser-native `title` tooltip on web, distinguishing
 * "temporarily unavailable, here's why" from a plain disabled
 * state. A dedicated Tooltip primitive isn't in the system yet;
 * when it lands, replace the title-attribute fallback with a real
 * tooltip.
 */
const iconActionVariants = cva(
  cn(
    'group/icon-action shrink-0 items-center justify-center rounded-sm',
    Platform.select({
      web: 'outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-focus-ring',
      default: '',
    }),
  ),
  {
    variants: {
      size: {
        sm: 'h-icon-action-sm w-icon-action-sm',
        md: 'h-icon-action-md w-icon-action-md',
        lg: 'h-icon-action-lg w-icon-action-lg',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

const enabledStateClasses = cn(
  'active:bg-tint-press',
  Platform.select({ web: 'hover:bg-tint-hover', default: '' }) ?? '',
)

const disabledStateClasses =
  Platform.select({
    web: 'pointer-events-none cursor-not-allowed',
    default: '',
  }) ?? ''

const disabledWithReasonExtras = Platform.select({ web: 'cursor-help', default: '' }) ?? ''

const iconColorVariants = cva(
  cn(Platform.select({ web: 'transition-colors duration-150', default: '' }) ?? ''),
  {
    variants: {
      tone: {
        enabled: cn(
          'text-fg-secondary',
          Platform.select({
            web: 'group-hover:text-fg-primary group-focus-visible:text-fg-primary group-hover/icon-action:text-fg-primary',
            default: '',
          }) ?? '',
        ),
        'enabled-destructive': cn(
          'text-fg-secondary',
          Platform.select({
            web: 'group-hover:text-fg-primary group-focus-visible:text-fg-primary group-hover/icon-action:text-danger',
            default: '',
          }) ?? '',
        ),
        disabled: 'text-fg-muted',
      },
    },
    defaultVariants: { tone: 'enabled' },
  },
)

type IconActionVariant = 'default' | 'destructive'
type IconActionSize = NonNullable<VariantProps<typeof iconActionVariants>['size']>

type IconActionProps = Omit<PressableProps, 'children' | 'aria-label'> & {
  /** Lucide icon component. Pass the imported component itself: `<IconAction icon={Pencil} ... />`. */
  icon: LucideIcon
  /** Accessible name for the action (e.g. "Edit entry"). Required. */
  label: string
  size?: IconActionSize
  variant?: IconActionVariant
  /**
   * When provided alongside `disabled`, surfaces as the accessible
   * name on hover and as the browser-native `title` tooltip on web.
   * Use for "temporarily unavailable" cases per
   * [icon-actions.md → Disabled vs hidden](../../docs/ui/patterns/icon-actions.md#disabled-vs-hidden).
   */
  disabledReason?: string
  className?: string
}

const HIT_SLOPS = {
  sm: 8,
  md: 6,
  lg: 4,
} satisfies Record<IconActionSize, number>

const SIZE_TO_ICON_SIZE: Record<IconActionSize, IconSizeVariant> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
}

export function IconAction({
  icon,
  label,
  size = 'md',
  variant = 'default',
  disabled,
  disabledReason,
  className,
  ...props
}: IconActionProps) {
  const accessibleName = disabled && disabledReason ? disabledReason : label
  const tone = disabled ? 'disabled' : variant === 'destructive' ? 'enabled-destructive' : 'enabled'
  const pressable = (
    <TextClassContext.Provider value={iconColorVariants({ tone })}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibleName}
        aria-label={accessibleName}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled ?? undefined}
        hitSlop={HIT_SLOPS[size]}
        className={cn(
          iconActionVariants({ size }),
          disabled ? disabledStateClasses : enabledStateClasses,
          disabled && disabledReason && disabledWithReasonExtras,
          className,
        )}
        {...props}
      >
        <Icon as={icon} size={SIZE_TO_ICON_SIZE[size]} />
      </Pressable>
    </TextClassContext.Provider>
  )
  // RN-Web's Pressable runs its props through a DOM-attribute allowlist
  // that doesn't include `title`, so a direct prop spread never reaches
  // the rendered element. Wrapping in a raw div on web — the runtime
  // is React DOM there — gives the browser-native tooltip until a
  // dedicated Tooltip primitive lands.
  if (disabled && disabledReason && Platform.OS === 'web') {
    return (
      <div title={disabledReason} style={{ display: 'inline-flex' }}>
        {pressable}
      </div>
    )
  }
  return pressable
}

export { iconActionVariants }
export type { IconActionProps, IconActionSize, IconActionVariant }
