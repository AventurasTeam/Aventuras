// Aventuras SwitchRow pattern — the canonical cross-platform shape
// for boolean settings. Label + optional hint on the left, Switch
// visual indicator on the right; the WHOLE ROW is the tap target.
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
//   touch where the Switch indicator is just ~24-28px tall.
//
// The standalone <Switch> primitive stays exported as a building
// block — SwitchRow consumes it as a pointer-events-none visual
// indicator. Future cases that genuinely need a non-row switch
// (toolbar quick-toggle, inline status indicator) can compose
// Switch directly.
//
// Tap-target plumbing: outer Pressable handles all touch + a11y
// (role="switch", accessibilityState reflecting checked state).
// Inner Switch is wrapped in a View with `pointerEvents="none"` so
// taps fall through to the row Pressable rather than firing the
// inner Switch's own onCheckedChange (we'd otherwise double-fire
// or get nested-Pressable event ordering surprises). The inner
// Switch's required onCheckedChange takes a no-op handler.

import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const noop = () => {}

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
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onCheckedChange(!checked)}
      className={cn(
        'flex-row items-center gap-3 rounded-md px-row-x-md py-row-y-md',
        'active:bg-bg-raised',
        Platform.select({ web: 'cursor-pointer hover:bg-bg-raised' }),
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
      <View
        // Block taps from reaching the inner Switch's own Pressable —
        // the outer row Pressable owns the touch handling.
        pointerEvents="none"
      >
        <Switch checked={checked} onCheckedChange={noop} disabled={disabled} />
      </View>
    </Pressable>
  )
}

export type { SwitchRowProps }
