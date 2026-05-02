import { View } from 'react-native'
import { Text } from '@/components/ui/text'

const TOKENS = [
  { slot: '--row-pad-y / --row-pad-x', cls: 'p-row', label: 'List row' },
  { slot: '--input-pad-y / --input-pad-x', cls: 'p-input', label: 'Form input' },
  { slot: '--button-pad-y / --button-pad-x', cls: 'p-button', label: 'Button' },
] as const

export function SpacingDemo() {
  return (
    <View className="flex-col gap-3 p-4">
      <Text size="lg">Spacing tokens</Text>
      <View className="flex-col gap-2">
        {TOKENS.map((row) => (
          <View key={row.slot} className="flex-col gap-1">
            <Text variant="muted" size="xs">
              {row.slot}
            </Text>
            <View className={`${row.cls} rounded-sm bg-bg-raised`}>
              <Text>{row.label}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}
