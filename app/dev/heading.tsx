import { ScrollView, View } from 'react-native'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export default function HeadingDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Levels</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            level drives role=&quot;heading&quot; + aria-level. Size + weight defaults bake in per
            level.
          </Text>
          <View className="mt-3 flex-col items-start gap-3">
            <Heading level={1}>Level 1 — page title</Heading>
            <Heading level={2}>Level 2 — section title</Heading>
            <Heading level={3}>Level 3 — sub-section</Heading>
            <Heading level={4}>Level 4</Heading>
            <Heading level={5}>Level 5</Heading>
            <Heading level={6}>Level 6</Heading>
          </View>
        </View>
        <View>
          <Heading level={3}>Override</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Defaults stay opt-out; override `size` or pass `className` for non-default visual
            treatment. `level` keeps the semantic role + aria-level.
          </Text>
          <View className="mt-3 flex-col items-start gap-3">
            <Heading level={2} size="xl">
              level 2, size override → xl
            </Heading>
            <Heading level={3} className="font-bold">
              level 3, weight override → bold
            </Heading>
            <Heading level={1} variant="muted">
              level 1, variant=muted
            </Heading>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
