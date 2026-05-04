import type { LucideIcon, LucideProps } from 'lucide-react-native'
import { cssInterop } from 'nativewind'
import * as React from 'react'

import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const ICON_SIZE_PX = {
  sm: 16,
  md: 20,
  lg: 24,
} as const

type IconSizeVariant = keyof typeof ICON_SIZE_PX

type IconProps = Omit<LucideProps, 'size'> & {
  /**
   * The Lucide icon component to render. Pass the imported component
   * itself, not a string name: `<Icon as={Settings} />`. See
   * [`iconography.md`](../../docs/ui/foundations/iconography.md) for
   * the canonical glyph vocabulary.
   */
  as: LucideIcon
  /**
   * Sizing token: `'sm'` (16 px, inline with body text), `'md'` (20 px,
   * default chrome), `'lg'` (24 px, emphasis chrome). Numeric override
   * accepted for the rare non-canonical case; justify at use site.
   */
  size?: IconSizeVariant | number
}

const wired = new WeakSet<LucideIcon>()
function ensureWired(IconComponent: LucideIcon) {
  if (wired.has(IconComponent)) return
  cssInterop(IconComponent, {
    className: {
      target: 'style',
      nativeStyleToProp: {
        color: true,
        opacity: true,
      },
    },
  })
  wired.add(IconComponent)
}

export function Icon({
  as: IconComponent,
  size = 'md',
  strokeWidth = 2,
  className,
  ...props
}: IconProps) {
  ensureWired(IconComponent)
  const textClass = React.useContext(TextClassContext)
  const resolvedSize = typeof size === 'number' ? size : ICON_SIZE_PX[size]
  return (
    <IconComponent
      size={resolvedSize}
      strokeWidth={strokeWidth}
      className={cn('text-fg-primary', textClass, className)}
      {...props}
    />
  )
}

export { ICON_SIZE_PX }
export type { IconProps, IconSizeVariant }
