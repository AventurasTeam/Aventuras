import type { ReactNode } from 'react'
import { View } from 'react-native'

import { Text } from '@/components/ui/text'

/** A detail tab's sub-section: an uppercase label over its rows. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text
        size="xs"
        variant="muted"
        accessibilityRole="header"
        className="font-medium uppercase tracking-wide"
      >
        {title}
      </Text>
      {children}
    </View>
  )
}
