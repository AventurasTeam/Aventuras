import { ActivityIndicator, Platform, Pressable, type PressableProps } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { TextClassContext } from '@/components/ui/text'
import { useTheme } from '@/lib/themes/use-theme'
import type { ThemeColorSlots } from '@/lib/themes/types'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  cn(
    'group shrink-0 flex-row items-center justify-center gap-2 rounded-md',
    Platform.select({
      web: 'outline-none transition-colors disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:pointer-events-none [&_svg]:shrink-0',
    }),
  ),
  {
    variants: {
      variant: {
        primary: cn(
          'bg-accent active:bg-accent-hover',
          Platform.select({ web: 'hover:bg-accent-hover' }),
        ),
        secondary: cn(
          // Hover/active tint: bg-fg-muted at low opacity. Direct
          // bg-* tier slots sit within ~1-3% of bg-base in light
          // themes, making them invisible as hover/active states.
          // fg-muted is mid-gray in every theme; its translucent
          // layer renders visibly in both light and dark.
          'border border-border bg-bg-base active:bg-fg-muted/15',
          Platform.select({ web: 'hover:border-border-strong' }),
        ),
        ghost: cn(
          'bg-transparent active:bg-fg-muted/15',
          Platform.select({ web: 'hover:bg-fg-muted/10' }),
        ),
        destructive: cn(
          'bg-danger active:opacity-90',
          Platform.select({ web: 'hover:opacity-90' }),
        ),
      },
      size: {
        sm: cn(
          'h-control-sm gap-1.5 rounded-sm px-3',
          Platform.select({ web: 'has-[>svg]:px-2.5' }),
        ),
        md: cn('h-control-md px-4', Platform.select({ web: 'has-[>svg]:px-3' })),
        lg: cn('h-control-lg rounded-lg px-6', Platform.select({ web: 'has-[>svg]:px-4' })),
        icon: 'h-control-md w-control-md rounded-md',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

const buttonTextVariants = cva(
  cn('text-sm font-medium', Platform.select({ web: 'pointer-events-none transition-colors' })),
  {
    variants: {
      variant: {
        primary: 'text-accent-fg',
        secondary: 'text-fg-primary',
        ghost: 'text-fg-primary',
        destructive: 'text-danger-fg',
      },
      size: { sm: '', md: '', lg: 'text-base', icon: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const SPINNER_SLOT_BY_VARIANT: Record<ButtonVariant, keyof ThemeColorSlots> = {
  primary: '--accent-fg',
  secondary: '--fg-primary',
  ghost: '--fg-primary',
  destructive: '--danger-fg',
}

type ButtonProps = PressableProps &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean
    className?: string
  }

export function Button({
  className,
  variant,
  size,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading
  const { theme: activeTheme } = useTheme()
  const spinnerSlot = SPINNER_SLOT_BY_VARIANT[(variant ?? 'primary') as ButtonVariant]
  // Web resolves var(--*) against the nearest [data-theme] scope so per-row
  // ThemeMatrix scoping works; native has no DOM cascade so we read from the
  // active theme directly.
  const spinnerColor = Platform.select({
    web: `var(${spinnerSlot})`,
    default: activeTheme.colors[spinnerSlot],
  })
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
        disabled={isDisabled ?? undefined}
        className={cn(isDisabled && 'opacity-50', buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : children}
      </Pressable>
    </TextClassContext.Provider>
  )
}

export { buttonVariants, buttonTextVariants }
export type { ButtonProps }
