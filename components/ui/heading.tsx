// Aventuras Heading primitive — semantic heading on top of Text.
//
// Per docs/ui/components.md augmentation policy: a separate primitive rather
// than a Text variant, because heading-level is a semantic axis (drives
// `role="heading"` + `aria-level`) that's orthogonal to Text's visual axes
// (color slot, size). Bakes in default size + weight per level matching the
// MUI-style theme-driven typography pattern; consumers override via the
// usual Text props (`size`, `className`) when a non-default treatment is
// needed.
//
// Defaults (xl/lg/base/sm/xs map to Aventuras's typography ramp; weights
// map to docs/ui/foundations/typography.md):
//
//   level 1 → xl   + semibold  (page-level title)
//   level 2 → lg   + semibold  (section title)
//   level 3 → base + semibold  (sub-section title)
//   level 4 → base + medium
//   level 5 → sm   + medium
//   level 6 → xs   + medium
import { Text, type TextProps } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

const HEADING_DEFAULTS: Record<HeadingLevel, { size: TextProps['size']; weight: string }> = {
  1: { size: 'xl', weight: 'font-semibold' },
  2: { size: 'lg', weight: 'font-semibold' },
  3: { size: 'base', weight: 'font-semibold' },
  4: { size: 'base', weight: 'font-medium' },
  5: { size: 'sm', weight: 'font-medium' },
  6: { size: 'xs', weight: 'font-medium' },
}

type HeadingProps = TextProps & {
  level: HeadingLevel
}

export function Heading({ level, size, className, ...props }: HeadingProps) {
  const defaults = HEADING_DEFAULTS[level]
  return (
    <Text
      size={size ?? defaults.size}
      className={cn(defaults.weight, className)}
      role="heading"
      aria-level={String(level)}
      {...props}
    />
  )
}

export type { HeadingProps, HeadingLevel }
