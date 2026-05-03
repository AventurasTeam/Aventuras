import { useState } from 'react'
import { Platform, Pressable, View } from 'react-native'
import { Text } from '@/components/ui/text'

type Sample = {
  label: string
  // Pre-resolved literal class names so Tailwind's content scan
  // compiles them — dynamic concatenation hides them from JIT.
  motion: string
}

const SAMPLES: readonly Sample[] = [
  {
    label: '--duration-fast × --easing-standard',
    motion: 'transition-transform duration-fast ease-standard',
  },
  {
    label: '--duration-base × --easing-standard',
    motion: 'transition-transform duration-base ease-standard',
  },
  {
    label: '--duration-slow × --easing-standard',
    motion: 'transition-transform duration-slow ease-standard',
  },
  {
    label: '--duration-fast × --easing-emphasis',
    motion: 'transition-transform duration-fast ease-emphasis',
  },
  {
    label: '--duration-base × --easing-emphasis',
    motion: 'transition-transform duration-base ease-emphasis',
  },
  {
    label: '--duration-slow × --easing-emphasis',
    motion: 'transition-transform duration-slow ease-emphasis',
  },
] as const

const ANIMATE_ON_PLATFORM = Platform.OS === 'web'

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
          {ANIMATE_ON_PLATFORM ? 'Tap to replay' : 'Token reference (animation: web only for now)'}
        </Text>
      </Pressable>
      <View className="flex-col gap-3">
        {SAMPLES.map((s) => (
          <View key={s.label} className="flex-col gap-1">
            <Text variant="muted" size="xs">
              {s.label}
            </Text>
            {ANIMATE_ON_PLATFORM ? (
              <View
                key={tick}
                className={`h-4 w-16 rounded-sm bg-accent ${s.motion}`}
                style={{ transform: [{ translateX: tick % 2 === 0 ? 0 : 100 }] }}
              />
            ) : (
              <View className="h-4 w-16 rounded-sm bg-accent" />
            )}
          </View>
        ))}
      </View>
    </View>
  )
}
