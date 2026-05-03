import { View } from 'react-native'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useDensity } from '@/lib/density/use-density'
import type { DensitySetting } from '@/lib/density/types'

const OPTIONS: { value: DensitySetting; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'compact', label: 'Compact' },
  { value: 'regular', label: 'Regular' },
  { value: 'comfortable', label: 'Comfortable' },
]

export function DensityPicker() {
  const { setting, resolved, setSetting } = useDensity()
  return (
    <View className="flex-col gap-2 border-b border-border bg-bg-base p-4">
      <View className="flex-row items-baseline gap-3">
        <Text variant="muted" size="sm">
          Density
        </Text>
        <Text variant="muted" size="xs">
          (resolved: {resolved})
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            variant={opt.value === setting ? 'primary' : 'secondary'}
            onPress={() => setSetting(opt.value)}
          >
            <Text>{opt.label}</Text>
          </Button>
        ))}
      </View>
    </View>
  )
}
