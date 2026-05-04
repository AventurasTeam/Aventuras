import * as React from 'react'
import { Platform, View } from 'react-native'

import type { DensityValue } from '@/lib/density/types'
import { useDensity } from '@/lib/density/use-density'
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
