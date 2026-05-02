import { ScrollView, View } from 'react-native'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

export default function ButtonDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Text size="lg">Variants</Text>
          <View className="mt-2 flex-row flex-wrap gap-3">
            <Button variant="primary">
              <Text>Primary</Text>
            </Button>
            <Button variant="secondary">
              <Text>Secondary</Text>
            </Button>
            <Button variant="ghost">
              <Text>Ghost</Text>
            </Button>
            <Button variant="destructive">
              <Text>Destructive</Text>
            </Button>
          </View>
        </View>
        <View>
          <Text size="lg">Sizes</Text>
          <View className="mt-2 flex-row items-center gap-3">
            <Button size="sm">
              <Text>Small</Text>
            </Button>
            <Button size="md">
              <Text>Medium</Text>
            </Button>
            <Button size="lg">
              <Text>Large</Text>
            </Button>
            <Button size="icon">
              <Text>⚙</Text>
            </Button>
          </View>
        </View>
        <View>
          <Text size="lg">States</Text>
          <View className="mt-2 flex-col gap-2">
            <Button>
              <Text>Idle</Text>
            </Button>
            <Button disabled>
              <Text>Disabled</Text>
            </Button>
            <Button loading>
              <Text>Loading</Text>
            </Button>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
