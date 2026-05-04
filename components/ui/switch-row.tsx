// Aventuras SwitchRow pattern — the canonical cross-platform shape
// for boolean settings. Label + optional hint on the left, switch
// indicator on the right; the WHOLE ROW is the tap target.
//
// Why this is a pattern, not a primitive variant:
//
// - All v1 wireframe consumers (Story Settings, Plot) use the
//   row-tappable shape — standalone Switch as the affordance
//   doesn't appear in v1.
// - Modern desktop OSes have converged on row-tappable toggles
//   (macOS Ventura+ System Settings, Windows 11 Settings, GNOME
//   Settings); standalone-switch-with-adjacent-label is the
//   old-school NSSwitch shape, no longer canonical.
// - Click-anywhere-on-row is faster than aiming at the small
//   switch visual on every tier — particularly important on
//   touch where the indicator is just ~24-28px tall.
//
// Architecture:
//
// - The row's outer Pressable is the only interactive element
//   in the tree. It owns `role="switch"`, `aria-checked`, the
//   accessible-name wiring, and the press handler.
// - The switch indicator is rendered via `<SwitchVisual>`, a pure
//   presentational component (track + thumb View, no Pressable,
//   no role). This avoids the nested-interactive a11y issue that
//   appeared when SwitchRow rendered the full `<Switch>` (an
//   interactive Pressable) inside its own Pressable.
//
// A11y contract:
//
// - `role="switch"` on the outer Pressable.
// - `aria-checked` set explicitly from the `checked` prop.
//   `accessibilityState={{ checked }}` alone doesn't always map
//   to `aria-checked` on web via RN-Web; setting both is
//   belt-and-suspenders.
// - `aria-label={label}` provides the accessible name. Hint is
//   visible-only — wiring it to `aria-describedby` would require
//   a stable nativeID across platforms; deferred unless a11y
//   review demands it.

import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'

import { SwitchVisual } from '@/components/ui/switch-visual'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type SwitchRowProps = {
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: SwitchRowProps) {
  return (
    <Pressable
      role="switch"
      aria-checked={checked}
      aria-label={label}
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onCheckedChange(!checked)}
      className={cn(
        'flex-row items-center gap-3 rounded-md px-row-x-md py-row-y-md',
        // Hover/active state-layer via --tint-hover / --tint-press
        // (color-mix on --fg-primary, defined in global.css).
        // Direct bg-* tier slots sit within ~1-3% of bg-base in
        // light themes — invisible as state feedback.
        'active:bg-tint-press',
        Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
        disabled && 'opacity-50',
        Platform.select({ web: disabled && 'cursor-not-allowed' }),
        className,
      )}
    >
      <View className="flex-1 gap-0.5">
        <Text className="font-medium">{label}</Text>
        {hint != null ? (
          <Text variant="muted" size="sm">
            {hint}
          </Text>
        ) : null}
      </View>
      <SwitchVisual checked={checked} disabled={disabled} />
    </Pressable>
  )
}

export type { SwitchRowProps }
