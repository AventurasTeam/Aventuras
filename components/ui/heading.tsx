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
  /**
   * Heading level (1–6). Drives `role="heading"` + `aria-level` for
   * a11y and bakes in default `size` + weight per level. Override
   * `size` to break the level→size pairing (e.g. visually small but
   * semantically h2). For non-heading text, use `Text` directly.
   */
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

export type { HeadingLevel, HeadingProps }
