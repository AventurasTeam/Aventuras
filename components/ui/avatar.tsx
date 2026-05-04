// Aventuras Avatar primitive — Phase 2 Group E.
//
// Wraps `@rn-primitives/avatar` (Root + Image + Fallback) with the
// project's slot system and a sizing scale tied to v1 wireframe
// use sites.
//
// Sourcing:
//
// - RESHAPED: from the react-native-reusables baseline. The
//   baseline ships a single fixed `size-8` shape with `bg-muted`
//   fallback and exports the three Radix-style parts directly.
//   Aventuras shape adds:
//     - A size variant scale (`xs`/`sm`/`md`/`lg`) that maps to
//       v1 wireframe use sites (mini portrait list / row leading /
//       compact peek head / desktop overview hero).
//     - A convenience component shape that takes `src` + `fallback`
//       inline, since 95 % of v1 use sites render image-with-
//       fallback. The compositional `Avatar.Root / .Image /
//       .Fallback` triad is still exported for the rare
//       custom-layout case.
//     - Token-driven slots (`bg-bg-sunken`, `text-fg-secondary`
//       for the fallback) replacing the baseline's `bg-muted`
//       single-token wash.
// - ACCEPTED: rn-primitives compositional shape; the `alt`
//   requirement on Root (a11y); the loading-state mechanism
//   (Image renders if it loads, Fallback is the placeholder).
// - SLOT CHOICE: fallback uses `bg-bg-sunken` + `border-border` to
//   define the circle shape. Two slots ruled out along the way:
//     - `bg-bg-sunken` alone is invisible on themes whose sunken
//       sits within ~1-3 % of `bg-base` (cyberpunk, fallen-down,
//       parchment, catppuccin-latte).
//     - `bg-fg-muted` is visible in every theme but takes on
//       theme tint where `fg-muted` is colored rather than
//       achromatic — Royal becomes purple, Aventuras Signature
//       becomes gold, Parchment becomes brown. Correct for
//       Switch's off-track (small pill) but too prominent for a
//       large avatar circle.
//   `border-border` is calibrated by the theme registry to be
//   visible against `bg-base` in every theme (it's the slot used
//   for all separators), so it gives the circle a crisp outline
//   independent of fill contrast. Fallback content (initials
//   text, entity-kind glyph) uses `text-fg-secondary` — readable
//   on the subtle sunken fill in every theme.
//
// Sizing scale — tied to v1 use sites:
//
// - `xs` = 24 px — "members here" / "first 3 portraits" mini-row
//   inside detail-pane Overview cards (faction members, location
//   characters-here counts).
// - `sm` = 40 px — default row leading in lists; a comfortable
//   touch target without dominating row height.
// - `md` = 96 px — compact peek head and mobile reflow of the
//   overview portrait (per `world.md → Overview portrait reflows
//   on phone`).
// - `lg` = 220 px — desktop overview hero portrait floating
//   upper-right of the detail head (per `world.md → Overview`).
//
// Fallback rendering:
//
// - `string` fallback → centered text. Caller's responsibility to
//   pass initials (`"DV"`) or short kind label. Font size scales
//   with avatar size for legibility.
// - `ReactNode` fallback → rendered as-is. Typical use: an Icon
//   for entity-kind glyphs (`<Icon as={User} />` for a missing
//   character portrait, `<Icon as={MapPin} />` for a location,
//   etc.).
// - Omitted → empty `bg-bg-sunken` placeholder.

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
  size?: AvatarSize
  src?: string
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
        {/* Provide muted color context so both Text and Icon
            fallbacks inherit text-fg-secondary without callers
            wiring it explicitly. Avatar's visual goal is a
            quiet disc with quiet content, distinct from the
            full-strength foreground used elsewhere. */}
        <TextClassContext.Provider value="text-fg-secondary">
          {isStringFallback(fallback) ? (
            <Text
              // Two-step centering for cap-letter initials:
              //
              // - `leading-none` collapses Text's intrinsic line-
              //   height to 1.0; without it the flex parent centers
              //   the line box (glyph + leading), which already
              //   drifts.
              // - `translate-y-[0.08em]` nudges the glyph down by
              //   ~8 % of font-em to compensate for the intrinsic
              //   font-metric asymmetry — cap letters like "DV"
              //   span roughly the upper 70 % of the em box (cap-
              //   height to baseline), so their visual center sits
              //   above the geometric center of a leading-none line
              //   box. translate (vs padding) doesn't change Text's
              //   bounding box, so the flex parent's center
              //   calculation isn't perturbed; em-relative scales
              //   linearly across the four avatar sizes. Icons
              //   don't hit this because SVG glyphs aren't tied to
              //   font-baseline metrics.
              className={cn(
                'translate-y-[0.08em] font-medium leading-none',
                FALLBACK_TEXT_SIZE[size],
              )}
              // Avatar is decorative once `alt` covers the semantic name;
              // hide the initials from screen readers so they don't read
              // out as "DV" alongside the alt text.
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

// Compositional escape hatch for layouts that need direct access to
// the rn-primitives parts (e.g., overlaying a status badge on the
// fallback). Most consumers should use `<Avatar />` directly.
export const AvatarRoot = AvatarPrimitive.Root
export const AvatarImage = AvatarPrimitive.Image
export const AvatarFallback = AvatarPrimitive.Fallback

export type { AvatarProps, AvatarSize }
export { SIZE_CLASSES as AVATAR_SIZE_CLASSES }
