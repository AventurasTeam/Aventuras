import { cn } from '@/lib/utils'
import { Slot } from '@rn-primitives/slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { createContext, useContext } from 'react'
import { Text as RNText, type TextProps as RNTextProps } from 'react-native'

export const TextClassContext = createContext<string | undefined>(undefined)

const textVariants = cva('', {
  variants: {
    variant: {
      default: 'text-fg-primary',
      secondary: 'text-fg-secondary',
      muted: 'text-fg-muted',
      disabled: 'text-fg-disabled',
    },
    size: {
      xs: 'text-xs',
      sm: 'text-sm',
      base: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl',
    },
  },
})

type TextProps = RNTextProps &
  VariantProps<typeof textVariants> & {
    className?: string
    asChild?: boolean
  }

export function Text({ className, variant, size, asChild = false, style, ...props }: TextProps) {
  const inherited = useContext(TextClassContext)
  const Component = asChild ? Slot : RNText
  const fallbackColor = !variant && !inherited ? 'text-fg-primary' : ''
  const fallbackSize = !size && !inherited ? 'text-base' : ''
  return (
    <Component
      className={cn(
        fallbackColor,
        fallbackSize,
        inherited,
        textVariants({ variant, size }),
        className,
      )}
      style={style}
      {...props}
    />
  )
}

export type { TextProps }
