import * as React from 'react'
import { Platform, Pressable } from 'react-native'

import { SwitchVisual } from '@/components/ui/switch-visual'
import { cn } from '@/lib/utils'

type SwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  /**
   * Required for standalone Switch. The row-shape pattern is
   * SwitchRow — prefer that for label+toggle combinations; use bare
   * Switch only for cases that don't fit the row shape (e.g. inline
   * toggle inside a sentence).
   */
  'aria-label'?: string
  /** Alternative to `aria-label` — points at an existing label element by id. */
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
