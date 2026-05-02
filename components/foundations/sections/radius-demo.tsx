import { View } from 'react-native'
import { Text } from '@/components/ui/text'

const RADII = ['sm', 'md', 'lg', 'full'] as const

export function RadiusDemo() {
  return (
    <View className="flex-col gap-3 p-4">
      <Text size="lg">Radii</Text>
      <View className="flex-row gap-3">
        {RADII.map((r) => (
          <View key={r} className="flex-col items-center gap-1">
            <View className={`h-16 w-16 bg-accent rounded-${r}`} />
            <Text variant="muted" size="xs">
              --radius-{r}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}
