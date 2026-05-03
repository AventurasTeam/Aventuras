// Aventuras Text primitive — color + size + heading-semantics + composition.
//
// Divergence from the react-native-reusables baseline, per the augmentation
// + subtraction policy in docs/ui/components.md:
//
// - REMOVED: semantic typography variants (h1-h4, p, blockquote, code, lead,
//   large, small) and the ROLE / ARIA_LEVEL mapping that bundled with them.
//   Aventuras typography (docs/ui/foundations/typography.md) is size-driven;
//   visual hero typography slots were skipped per the v1 contract. Heading
//   accessibility is restored below via `headingLevel`.
// - REPLACED: variant axis split into orthogonal `variant` (color slot) +
//   `size` (typography ramp). Matches Aventuras's `--fg-*` slot system and
//   xs/sm/base/lg/xl size scale. Maintains the upstream `defaultVariants`
//   contract via the conditional-fallback logic below.
// - RESTORED: `asChild` + `Slot` composition. Heading accessibility via the
//   new `headingLevel` prop, which sets `role="heading"` + `aria-level={N}`
//   without dictating visual styling (consumer composes size + className).
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

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

type TextProps = RNTextProps &
  VariantProps<typeof textVariants> & {
    className?: string
    asChild?: boolean
    headingLevel?: HeadingLevel
  }

export function Text({
  className,
  variant,
  size,
  asChild = false,
  headingLevel,
  style,
  ...props
}: TextProps) {
  const inherited = useContext(TextClassContext)
  const Component = asChild ? Slot : RNText
  // Conditional fallback emits the default class only when no other source
  // (variant prop, inherited context) sets the corresponding property.
  // Avoids Tailwind cascade ambiguity where multiple size/color classes in
  // one className resolve by CSS-output order, not className order.
  const fallbackColor = !variant && !inherited ? 'text-fg-primary' : ''
  const fallbackSize = !size && !inherited ? 'text-base' : ''
  const semanticProps = headingLevel
    ? { role: 'heading' as const, 'aria-level': String(headingLevel) }
    : {}
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
      {...semanticProps}
      {...props}
    />
  )
}

export type { TextProps, HeadingLevel }
