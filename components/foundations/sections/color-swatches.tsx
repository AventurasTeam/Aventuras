import { View } from 'react-native'
import { Text } from '@/components/ui/text'
import { useTheme } from '@/lib/themes/use-theme'
import { COLOR_SLOT_KEYS } from '@/lib/themes/types'

export function ColorSwatches() {
  const { theme } = useTheme()
  return (
    <View className="flex-col gap-3 p-4">
      <Text size="lg">Color slots ({COLOR_SLOT_KEYS.length})</Text>
      <View className="flex-row flex-wrap gap-3">
        {COLOR_SLOT_KEYS.map((slot) => (
          <View key={slot} className="w-40 flex-col gap-1">
            <View
              className="h-12 rounded-sm border border-border"
              style={{ backgroundColor: theme.colors[slot] }}
            />
            <Text size="xs" variant="muted">
              {slot}
            </Text>
            <Text size="xs">{theme.colors[slot]}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
