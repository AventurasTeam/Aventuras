import { useState } from 'react'
import { View, Pressable } from 'react-native'
import { Text } from '@/components/ui/text'

const SAMPLES = [
  { duration: 'fast', easing: 'standard', label: '--duration-fast × --easing-standard' },
  { duration: 'base', easing: 'standard', label: '--duration-base × --easing-standard' },
  { duration: 'slow', easing: 'standard', label: '--duration-slow × --easing-standard' },
  { duration: 'fast', easing: 'emphasis', label: '--duration-fast × --easing-emphasis' },
  { duration: 'base', easing: 'emphasis', label: '--duration-base × --easing-emphasis' },
  { duration: 'slow', easing: 'emphasis', label: '--duration-slow × --easing-emphasis' },
] as const

export function MotionSamples() {
  const [tick, setTick] = useState(0)
  return (
    <View className="flex-col gap-3 p-4">
      <Text size="lg">Motion</Text>
      <Pressable
        className="rounded-md bg-bg-raised p-3 active:bg-bg-sunken"
        onPress={() => setTick((t) => t + 1)}
      >
        <Text variant="muted" size="sm">
          Tap to replay
        </Text>
      </Pressable>
      <View className="flex-col gap-3">
        {SAMPLES.map((s) => (
          <View key={s.label} className="flex-col gap-1">
            <Text variant="muted" size="xs">
              {s.label}
            </Text>
            <View
              key={tick}
              className={`h-4 w-16 rounded-sm bg-accent transition-transform duration-${s.duration} ease-${s.easing}`}
              style={{ transform: [{ translateX: tick % 2 === 0 ? 0 : 100 }] }}
            />
          </View>
        ))}
      </View>
    </View>
  )
}
