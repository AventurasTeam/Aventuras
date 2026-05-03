// Aventuras Switch primitive — a Pressable wrapping the
// SwitchVisual presentation. Building block for the SwitchRow
// pattern; rarely used standalone (no v1 wireframe consumer
// uses a non-row switch).
//
// Why we don't compose @rn-primitives/switch.Root directly:
//
// - The upstream Root IS itself a Pressable with role="switch".
//   Composing it inside SwitchRow's outer Pressable produced
//   nested interactive elements, which axe flags ("Do not nest
//   interactive elements"). Even with `pointerEvents="none"` on a
//   wrapping View, the inner element remained a `<button>` in the
//   DOM; the rule is structural, not pointer-event-based.
// - The upstream's value-add is small (Pressable + role +
//   accessibilityState wiring). Replicating it in ~10 lines of our
//   own code lets both Switch and SwitchRow place a single
//   role="switch" Pressable at exactly the right level of the
//   tree without nested interactives.
//
// Visual reshape lives in `<SwitchVisual>`; this file owns the
// Pressable + a11y wiring.
//
// A11y contract:
//
// - `role="switch"` on the Pressable.
// - `aria-checked` set explicitly from `checked` prop. Despite
//   `accessibilityState={{ checked }}` being the RN-native pattern,
//   RN-Web's mapping to `aria-checked` doesn't always fire on
//   `<Pressable role="switch">` — axe reports "Required ARIA
//   attribute not present: aria-checked" without the explicit prop.
//   Set both for belt-and-suspenders.
// - `aria-label` is the consumer's responsibility. Standalone
//   `<Switch>` has no visible label inside; consumers MUST pass
//   `aria-label` for the control to be accessible-name-equipped.
//   `<SwitchRow>` derives `aria-label` from its `label` prop
//   automatically.

import * as React from 'react'
import { Platform, Pressable } from 'react-native'

import { SwitchVisual } from '@/components/ui/switch-visual'
import { cn } from '@/lib/utils'

type SwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  // Accessible name. Required for standalone Switch — without it,
  // screen readers announce only "switch, on/off" with no
  // identification. Optional in the type only because SwitchRow
  // consumes Switch internally and supplies the label there;
  // direct consumers should always pass this.
  'aria-label'?: string
  'aria-labelledby'?: string
}

export function Switch({ checked, onCheckedChange, disabled, className, ...rest }: SwitchProps) {
  return (
    <Pressable
      role="switch"
      aria-checked={checked}
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onCheckedChange(!checked)}
      className={cn(
        'rounded-full',
        Platform.select({
          web: 'focus-visible:ring-focus-ring/50 cursor-pointer outline-none transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed',
        }),
        className,
      )}
      {...rest}
    >
      <SwitchVisual checked={checked} disabled={disabled} />
    </Pressable>
  )
}

export type { SwitchProps }
