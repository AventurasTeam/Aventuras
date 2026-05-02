import { View } from 'react-native'
import { Text } from '@/components/ui/text'

const SCALE = [
  { slot: '--text-3xl', size: 'text-3xl', sample: 'The quick brown fox' },
  { slot: '--text-2xl', size: 'text-2xl', sample: 'The quick brown fox' },
  { slot: '--text-xl', size: 'text-xl', sample: 'The quick brown fox' },
  { slot: '--text-lg', size: 'text-lg', sample: 'The quick brown fox' },
  { slot: '--text-base', size: 'text-base', sample: 'The quick brown fox' },
  { slot: '--text-sm', size: 'text-sm', sample: 'The quick brown fox' },
  { slot: '--text-xs', size: 'text-xs', sample: 'The quick brown fox' },
] as const

export function TypeRamp() {
  return (
    <View className="flex-col gap-3 p-4">
      <Text size="lg">Type ramp</Text>
      <View className="flex-col gap-2">
        {SCALE.map((row) => (
          <View key={row.slot} className="flex-col gap-0.5">
            <Text variant="muted" size="xs">
              {row.slot}
            </Text>
            <Text className={row.size}>{row.sample}</Text>
          </View>
        ))}
        <View className="flex-col gap-0.5">
          <Text variant="muted" size="xs">
            --font-mono
          </Text>
          <Text className="font-mono">const a = 1; // monospace sample</Text>
        </View>
        <View className="flex-col gap-0.5">
          <Text variant="muted" size="xs">
            --font-reading
          </Text>
          <Text className="font-reading text-base">
            Reading prose in the load-bearing reading face. Lorem ipsum dolor sit amet.
          </Text>
        </View>
      </View>
    </View>
  )
}
