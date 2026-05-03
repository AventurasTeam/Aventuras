import { ScrollView, View } from 'react-native'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export default function TextDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Variants</Heading>
          <View className="mt-2 flex-col gap-1">
            <Text variant="default">Default — primary foreground</Text>
            <Text variant="secondary">Secondary — secondary foreground</Text>
            <Text variant="muted">Muted — muted foreground</Text>
            <Text variant="disabled">Disabled — disabled foreground</Text>
          </View>
        </View>
        <View>
          <Heading level={3}>Sizes</Heading>
          <View className="mt-2 flex-col items-start gap-1">
            <Text size="xs">Extra small (xs)</Text>
            <Text size="sm">Small (sm)</Text>
            <Text size="base">Base (default)</Text>
            <Text size="lg">Large (lg)</Text>
            <Text size="xl">Extra large (xl)</Text>
          </View>
        </View>
        <View>
          <Heading level={3}>Default body</Heading>
          <Text>
            The quick brown fox jumps over the lazy dog. Standalone usage with no variant or size
            prop falls back to base size + primary foreground per the conditional fallback in
            text.tsx.
          </Text>
        </View>
      </View>
    </ScrollView>
  )
}
