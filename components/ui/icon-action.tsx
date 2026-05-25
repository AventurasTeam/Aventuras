import { cva, type VariantProps } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react-native'
import type { Ref } from 'react'
import { Platform, Pressable, type PressableProps, type View } from 'react-native'

import { Icon, type IconSizeVariant } from '@/components/ui/icon'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

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
   */
  disabledReason?: string
  /**
   * Forwarded to the underlying Pressable. Required when an IconAction is
   * used as a rn-primitives `<...Trigger asChild>` child — Floating UI
   * anchors via the injected ref and drops the popover anchor without it.
   */
  ref?: Ref<View>
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
  ref,
  className,
  ...props
}: IconActionProps) {
  const accessibleName = disabled && disabledReason ? disabledReason : label
  const tone = disabled ? 'disabled' : variant === 'destructive' ? 'enabled-destructive' : 'enabled'
  const pressable = (
    <TextClassContext.Provider value={iconColorVariants({ tone })}>
      <Pressable
        ref={ref}
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
  if (disabled && disabledReason && Platform.OS === 'web') {
    return (
      <div title={disabledReason} className="inline-flex">
        {pressable}
      </div>
    )
  }
  return pressable
}

export { iconActionVariants }
export type { IconActionProps, IconActionSize, IconActionVariant }
