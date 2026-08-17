import type { ReactNode } from 'react'
import { View } from 'react-native'

// Web and Electron have no soft keyboard to make room for, so the column is
// plain. The native variant carries the whole mechanism.
export function KeyboardInsetColumn({ children }: { children: ReactNode }) {
  return <View className="flex-1">{children}</View>
}
