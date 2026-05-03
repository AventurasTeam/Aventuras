// Aventuras Text primitive — color + size + composition.
//
// Divergence from the react-native-reusables baseline, per the augmentation
// + subtraction policies in docs/ui/components.md:
//
// - REPLACED: variant axis split into orthogonal `variant` (color slot) +
//   `size` (typography ramp). Matches Aventuras's `--fg-*` slot system and
//   xs/sm/base/lg/xl size scale. Maintains the upstream `defaultVariants`
//   contract via the conditional-fallback logic below.
// - REMOVED: semantic typography variants (h1-h4, p, blockquote, code, lead,
//   large, small) and the embedded `ROLE` / `ARIA_LEVEL` mapping. Aventuras
//   typography (docs/ui/foundations/typography.md) is size-driven; hero
//   typography slots were skipped per the v1 contract. **Heading semantics
//   live in the sibling [`Heading`](./heading.tsx) primitive**, not on
//   Text — keeps Text's axes purely visual.
// - KEPT: `asChild` + `Slot` composition.
import { Slot } from '@rn-primitives/slot'
import { Text as RNText, type TextProps as RNTextProps } from 'react-native'
import { createContext, useContext } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

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
  // Conditional fallback emits the default class only when no other source
  // (variant prop, inherited context) sets the corresponding property.
  // Avoids Tailwind cascade ambiguity where multiple size/color classes in
  // one className resolve by CSS-output order, not className order.
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
