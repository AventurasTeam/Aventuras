// Aventuras Switch primitive — reshaped from react-native-reusables
// baseline (which itself wraps @rn-primitives/switch). Boolean
// toggle for binary settings (appearance toggles, per-story
// switches, wizard steps).
//
// Reshape per docs/ui/components.md sourcing rules:
//
// - RESHAPED: color tokens (bg-primary/bg-input/bg-background/
//   primary-foreground/foreground/focus-visible ring → bg-accent/
//   bg-fg-muted/bg-bg-base/accent-fg/fg-primary/focus-ring).
//   Shadow classes stripped (Aventuras flat-depth principle).
//   Dark-mode opacity dance (`dark:bg-input/80`,
//   `dark:bg-primary-foreground`, `dark:bg-foreground`) stripped —
//   the theme registry handles light/dark per-theme.
// - AUGMENTED (per components.md augmentation policy): track and
//   thumb dimensions bind to the active density. Phone defaults
//   to regular density (44pt-tier touch targets); desktop defaults
//   to compact (smaller, mouse-driven). The original baseline
//   shipped one fixed size that read as miniscule on phones —
//   touch UX guidance says hit-affordances need ≥44pt visual on
//   touch devices, not just hitSlop.
// - ACCEPTED: rn-primitives composition (Root + Thumb), web
//   focus-visible ring, `disabled:cursor-not-allowed` on web,
//   pointer-events-none on the thumb.
//
// Off-track color: `bg-fg-muted` rather than `bg-bg-sunken`. The
// bg-* tier slots all sit within ~3-5% lightness of each other on
// most themes (intentional — those are page-surface tiers); using
// bg-bg-sunken for the off track produced near-zero contrast
// against the thumb (bg-bg-base) and against the surrounding page
// across every theme. fg-muted is a mid-gray visible on both
// light and dark surfaces — track gets crisp edges and the thumb
// reads as a distinct affordance in both states.
//
// Earlier reshape note claimed "Switch dimensions are intentionally
// fixed (not density-token-driven)" with the rationale that
// switches are symbolic affordances. That decision was wrong: on
// touch devices a 32×18 switch is too small to tap reliably. Mobile
// testing surfaced the gap; this revision binds dimensions to
// density across all platforms (web + native).

import * as SwitchPrimitives from '@rn-primitives/switch'
import { Platform } from 'react-native'

import { useDensity } from '@/lib/density/use-density'
import type { DensityValue } from '@/lib/density/types'
import { cn } from '@/lib/utils'

// Per-density visuals. Track width = thumb + 2px border + 2 × thumb-padding,
// chosen so translate-x ≈ track-inner-width − thumb-width.
const TRACK_CLASSES: Record<DensityValue, string> = {
  compact: 'h-[1.15rem] w-8',
  regular: 'h-6 w-11',
  comfortable: 'h-7 w-12',
}
const THUMB_SIZE_CLASSES: Record<DensityValue, string> = {
  compact: 'size-4',
  regular: 'size-5',
  comfortable: 'size-6',
}
const THUMB_TRANSLATE_CLASSES: Record<DensityValue, string> = {
  compact: 'translate-x-3.5',
  regular: 'translate-x-5',
  comfortable: 'translate-x-5',
}

type SwitchProps = React.ComponentProps<typeof SwitchPrimitives.Root> & {
  className?: string
}

export function Switch({ className, ...props }: SwitchProps) {
  const { resolved } = useDensity()
  return (
    <SwitchPrimitives.Root
      className={cn(
        'flex shrink-0 flex-row items-center rounded-full border border-transparent',
        TRACK_CLASSES[resolved],
        Platform.select({
          web: 'focus-visible:ring-focus-ring/50 peer inline-flex cursor-pointer outline-none transition-all focus-visible:border-accent focus-visible:ring-[3px] disabled:cursor-not-allowed',
        }),
        props.checked ? 'bg-accent' : 'bg-fg-muted',
        props.disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          'rounded-full bg-bg-base transition-transform',
          THUMB_SIZE_CLASSES[resolved],
          Platform.select({ web: 'pointer-events-none block ring-0' }),
          props.checked ? THUMB_TRANSLATE_CLASSES[resolved] : 'translate-x-0',
        )}
      />
    </SwitchPrimitives.Root>
  )
}

export type { SwitchProps }
