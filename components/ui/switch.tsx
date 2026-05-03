// Aventuras Switch primitive — reshaped from react-native-reusables
// baseline (which itself wraps @rn-primitives/switch). Boolean
// toggle for binary settings (appearance toggles, per-story
// switches, wizard steps).
//
// Reshape per docs/ui/components.md sourcing rules:
//
// - RESHAPED: color tokens (bg-primary/bg-input/bg-background/
//   primary-foreground/foreground/focus-visible ring → bg-accent/
//   bg-bg-sunken/bg-bg-base/accent-fg/fg-primary/focus-ring).
//   Shadow classes stripped (Aventuras flat-depth principle).
//   Dark-mode opacity dance (`dark:bg-input/80`,
//   `dark:bg-primary-foreground`, `dark:bg-foreground`) stripped —
//   the theme registry handles light/dark per-theme.
// - ACCEPTED: rn-primitives composition (Root + Thumb), the
//   fixed track + thumb dimensions (h-[1.15rem] w-8 + size-4
//   thumb), the translate-x-3.5 thumb shift on checked, web
//   focus-visible ring, `disabled:cursor-not-allowed` on web.
// - SUBTRACTED: nothing material; baseline maps cleanly.
//
// Density binding: Switch dimensions are intentionally fixed (not
// density-token-driven). Switches aren't tap-target-bound the way
// rows are — they're symbolic affordances whose perceived size
// stays constant across densities. The label adjacent to a Switch
// (consumer-composed) does follow density.

import * as SwitchPrimitives from '@rn-primitives/switch'
import { Platform } from 'react-native'

import { cn } from '@/lib/utils'

type SwitchProps = React.ComponentProps<typeof SwitchPrimitives.Root> & {
  className?: string
}

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitives.Root
      className={cn(
        'flex h-[1.15rem] w-8 shrink-0 flex-row items-center rounded-full border border-transparent',
        Platform.select({
          web: 'focus-visible:ring-focus-ring/50 peer inline-flex outline-none transition-all focus-visible:border-accent focus-visible:ring-[3px] disabled:cursor-not-allowed',
        }),
        props.checked ? 'bg-accent' : 'bg-bg-sunken',
        props.disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          'size-4 rounded-full bg-bg-base transition-transform',
          Platform.select({ web: 'pointer-events-none block ring-0' }),
          props.checked ? 'translate-x-3.5' : 'translate-x-0',
        )}
      />
    </SwitchPrimitives.Root>
  )
}

export type { SwitchProps }
