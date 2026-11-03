import type { ReactElement } from 'react'
import { View } from 'react-native'

import { chapterProgressTone, type ChapterProgressTone } from '@/lib/chapters'
import { cn } from '@/lib/utils'

const TONE_FILL: Record<ChapterProgressTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

/** 0–100; a NaN reads 0. */
export function clampPercent(percent: number): number {
  return percent > 0 ? Math.min(percent, 100) : 0
}

export type ChapterProgressBarProps = {
  /** Clamped through `clampPercent`. Sets the tone too, through `chapterProgressTone`. */
  percent: number
  /** Carries the track's height, which has no default. */
  className?: string
}

export function ChapterProgressBar({ percent, className }: ChapterProgressBarProps): ReactElement {
  const width = clampPercent(percent)
  return (
    <View className={cn('w-full overflow-hidden bg-bg-sunken', className)}>
      <View
        testID="chapter-progress-fill"
        className={cn('h-full', TONE_FILL[chapterProgressTone(width)])}
        style={{ width: `${width}%` }}
      />
    </View>
  )
}
