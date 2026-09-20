import type { ReactNode } from 'react'
import { View } from 'react-native'

import { cn } from '@/lib/utils'

// Web and Electron have no soft keyboard to make room for, so the column is
// plain. The native variant carries the whole mechanism.
export function KeyboardInsetColumn({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <View className={cn('flex-1', className)}>{children}</View>
}
