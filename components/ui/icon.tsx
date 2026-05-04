// Aventuras Icon primitive — Phase 2 Group E.
//
// Wraps a Lucide icon component with the project's sizing contract
// and color-inheritance rules. The icon-set choice (`lucide-react-
// native`) and the 16/20/24 sizing scale + locked 2 px stroke are
// canonical in
// [`docs/ui/foundations/iconography.md`](../../docs/ui/foundations/iconography.md);
// this primitive enforces them.
//
// Sourcing:
//
// - RESHAPED: Lucide does not ship a wrapper component — this is a
//   thin Aventuras-side primitive composing `as={LucideIcon}` plus
//   the variant→token sizing API.
// - REPLACED: the previous partial Icon piped NativeWind `size-N`
//   classes through cssInterop's `nativeStyleToProp` to lucide's
//   `size` prop. Group E retires that path: callers pass `size="md"`
//   (variant) or `size={N}` (numeric) and the primitive resolves to
//   a single `size` prop. The dual-passing pattern that grew up
//   around the partial (`size={20} className="size-5"`) is gone.
// - ADAPTED: cssInterop now pipes `style.color` → lucide's `color`
//   prop on native. Lucide-react-native renders SVGs whose `stroke`
//   binds to the `color` prop (default `"currentColor"`); on web
//   `currentColor` inherits via CSS, but on native there is no DOM
//   cascade — without this mapping, `text-*` classes on Icon are
//   inert on iOS/Android. Same shape as react-native-reusables'
//   `iconWithClassName` helper.
// - INHERITED: `TextClassContext` color inheritance. An Icon
//   inside a `<Text variant="muted">` parent picks up the muted
//   color slot without callers wiring `text-fg-muted` explicitly.
//
// Sizing contract (per iconography.md):
//
// - `sm` = 16 px — inline with body text, badge icons, list-row
//   glyphs.
// - `md` = 20 px (default) — chrome icons, button leading/trailing,
//   smaller top-bar buttons.
// - `lg` = 24 px — emphasis chrome: top-bar primary icons, hero
//   glyphs, section heads.
// - Numeric override accepted for the rare case that needs a
//   non-canonical size (e.g. a 14 px nudge for visual tuning).
//   Justify at use site.
//
// Stroke weight is locked at 2 — Lucide's default — uniform across
// the entire set. Override per-use only if a specific surface
// demands it (Checkbox bumps to 3.5 on native for visual parity at
// small sizes).

import * as React from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react-native'
import { cssInterop } from 'nativewind'

import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const ICON_SIZE_PX = {
  sm: 16,
  md: 20,
  lg: 24,
} as const

type IconSizeVariant = keyof typeof ICON_SIZE_PX

type IconProps = Omit<LucideProps, 'size'> & {
  as: LucideIcon
  size?: IconSizeVariant | number
}

// Memoize the cssInterop wiring per LucideIcon component. Calling
// cssInterop is one-shot: it tags a component constructor with the
// className→props mapping. Caching prevents re-tagging the same
// component on every render.
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

export type { IconProps, IconSizeVariant }
export { ICON_SIZE_PX }
