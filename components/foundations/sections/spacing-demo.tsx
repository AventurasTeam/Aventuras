import { View } from 'react-native'
import { Text } from '@/components/ui/text'

const TOKENS = [
  { slot: '--row-py-md / --row-px-md', cls: 'py-row-y-md px-row-x-md', label: 'List row' },
  { slot: '--control-h-md', cls: 'h-control-md justify-center px-3', label: 'Form control' },
  { slot: '--control-h-sm', cls: 'h-control-sm justify-center px-3', label: 'Compact control' },
] as const

export function SpacingDemo() {
  return (
    <View className="flex-col gap-3 p-4">
      <Text size="lg">Spacing tokens</Text>
      <Text variant="muted" size="xs">
        Density-aware — values swap with the active density (compact / regular / comfortable).
      </Text>
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
