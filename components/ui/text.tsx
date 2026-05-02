import { Text as RNText, type TextProps as RNTextProps } from 'react-native'
import { createContext, useContext } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const TextClassContext = createContext<string | undefined>(undefined)

const textVariants = cva('text-fg-primary', {
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
  defaultVariants: { variant: 'default', size: 'base' },
})

type TextProps = RNTextProps & VariantProps<typeof textVariants> & { className?: string }

export function Text({ className, variant, size, style, ...props }: TextProps) {
  const inherited = useContext(TextClassContext)
  return <RNText className={cn(inherited, textVariants({ variant, size }), className)} {...props} />
}
