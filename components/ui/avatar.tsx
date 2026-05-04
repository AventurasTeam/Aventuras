import * as AvatarPrimitive from '@rn-primitives/avatar'
import * as React from 'react'

import { Text, TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const SIZE_CLASSES = {
  xs: 'size-6',
  sm: 'size-10',
  md: 'size-24',
  lg: 'size-[220px]',
} as const

const FALLBACK_TEXT_SIZE = {
  xs: 'text-[10px]',
  sm: 'text-sm',
  md: 'text-2xl',
  lg: 'text-5xl',
} as const

type AvatarSize = keyof typeof SIZE_CLASSES

type AvatarProps = React.ComponentProps<typeof AvatarPrimitive.Root> & {
  /**
   * `'xs'` (24 px, mini portrait
   * row inside cards), `'sm'` (40 px, default row leading),
   * `'md'` (96 px, compact peek head + mobile portrait reflow),
   * `'lg'` (220 px, desktop overview hero).
   */
  size?: AvatarSize
  /** Image URL. Renders an Image; falls through to `fallback` on load error. */
  src?: string
  /**
   * Rendered when no `src` or when the image fails to load. Pass a
   * `string` for centered initials text (e.g. `"DV"`) or a ReactNode
   * for a custom shape — typical: an `<Icon as={User} />` for an
   * entity-kind glyph. Inherits muted color via TextClassContext.
   */
  fallback?: React.ReactNode | string
  imageClassName?: string
  fallbackClassName?: string
}

function isStringFallback(v: React.ReactNode | string | undefined): v is string {
  return typeof v === 'string'
}

export function Avatar({
  size = 'sm',
  src,
  fallback,
  alt,
  className,
  imageClassName,
  fallbackClassName,
  ...rootProps
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      alt={alt}
      className={cn(
        'relative shrink-0 overflow-hidden rounded-full border border-border bg-bg-sunken',
        SIZE_CLASSES[size],
        className,
      )}
      {...rootProps}
    >
      {src ? (
        <AvatarPrimitive.Image
          source={{ uri: src }}
          className={cn('aspect-square size-full', imageClassName)}
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className={cn('flex size-full items-center justify-center', fallbackClassName)}
      >
        <TextClassContext.Provider value="text-fg-secondary">
          {isStringFallback(fallback) ? (
            <Text
              className={cn(
                'translate-y-[0.08em] font-medium leading-none',
                FALLBACK_TEXT_SIZE[size],
              )}
              aria-hidden
            >
              {fallback}
            </Text>
          ) : (
            (fallback ?? null)
          )}
        </TextClassContext.Provider>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

export const AvatarRoot = AvatarPrimitive.Root
export const AvatarImage = AvatarPrimitive.Image
export const AvatarFallback = AvatarPrimitive.Fallback

export { SIZE_CLASSES as AVATAR_SIZE_CLASSES }
export type { AvatarProps, AvatarSize }
