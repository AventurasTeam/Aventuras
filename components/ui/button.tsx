import { ActivityIndicator, Platform, Pressable, type PressableProps } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { TextClassContext } from '@/components/ui/text'
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
          'border border-border bg-bg-base active:bg-bg-raised',
          Platform.select({ web: 'hover:border-border-strong' }),
        ),
        ghost: cn(
          'bg-transparent active:bg-bg-raised',
          Platform.select({ web: 'hover:bg-bg-raised' }),
        ),
        destructive: cn(
          'bg-danger active:opacity-90',
          Platform.select({ web: 'hover:opacity-90' }),
        ),
      },
      size: {
        sm: cn('h-8 gap-1.5 rounded-sm px-3', Platform.select({ web: 'has-[>svg]:px-2.5' })),
        md: cn('h-10 px-4 py-2', Platform.select({ web: 'has-[>svg]:px-3' })),
        lg: cn('h-12 rounded-lg px-6', Platform.select({ web: 'has-[>svg]:px-4' })),
        icon: 'h-10 w-10 rounded-md',
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
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
        disabled={isDisabled ?? undefined}
        className={cn(isDisabled && 'opacity-50', buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading ? <ActivityIndicator size="small" /> : children}
      </Pressable>
    </TextClassContext.Provider>
  )
}

export { buttonVariants, buttonTextVariants }
export type { ButtonProps }
