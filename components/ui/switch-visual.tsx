// SwitchVisual — pure visual track + thumb for a boolean toggle.
// Density-bound dimensions, no event handling, no role / a11y
// state. Composed by both the interactive `<Switch>` primitive and
// the `<SwitchRow>` pattern; extracting the visual lets each owner
// place its OWN single Pressable with the role="switch" semantics
// at exactly the right level of the tree, avoiding the
// nested-interactives a11y warning that appeared when SwitchRow
// rendered the full `<Switch>` (an interactive Pressable) inside
// its own Pressable.
//
// Visual contract (per density):
//
// - compact: track h-[1.15rem] w-8 (~18×32), thumb size-4 (16),
//   on-translate-x-3.5 (14)
// - regular: track h-6 w-11 (24×44), thumb size-5 (20),
//   on-translate-x-5 (20)
// - comfortable: track h-7 w-12 (28×48), thumb size-6 (24),
//   on-translate-x-5 (20)
//
// Track color: bg-fg-muted (off) / bg-accent (on). Thumb stays
// bg-bg-base on both states (contrast against both surfaces in
// light + dark themes via the registry).

import * as React from 'react'
import { Platform, View } from 'react-native'

import { useDensity } from '@/lib/density/use-density'
import type { DensityValue } from '@/lib/density/types'
import { cn } from '@/lib/utils'

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

type SwitchVisualProps = {
  checked: boolean
  disabled?: boolean
  className?: string
}

export function SwitchVisual({ checked, disabled, className }: SwitchVisualProps) {
  const { resolved } = useDensity()
  return (
    <View
      className={cn(
        'flex shrink-0 flex-row items-center rounded-full border border-transparent',
        TRACK_CLASSES[resolved],
        checked ? 'bg-accent' : 'bg-fg-muted',
        disabled && 'opacity-50',
        className,
      )}
    >
      <View
        className={cn(
          'rounded-full bg-bg-base',
          Platform.select({ web: 'transition-transform' }),
          THUMB_SIZE_CLASSES[resolved],
          checked ? THUMB_TRANSLATE_CLASSES[resolved] : 'translate-x-0',
        )}
      />
    </View>
  )
}

export type { SwitchVisualProps }
