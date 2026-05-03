import { ScrollView, View } from 'react-native'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'

export default function SheetDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Default</Heading>
          <View className="mt-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button>
                  <Text>Open sheet</Text>
                </Button>
              </SheetTrigger>
              <SheetContent>
                <View className="flex-col gap-3">
                  <Heading level={3}>Sheet</Heading>
                  <Text variant="muted" size="sm">
                    Bottom-anchored, medium height. Tap outside or press the back gesture to
                    dismiss.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
          </View>
        </View>
        <View>
          <Heading level={3}>Anchors</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            On phone, bottom is the natural shape; right is included for parity (collapses awkwardly
            on narrow screens).
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>bottom</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="medium">
                <View className="flex-col gap-2">
                  <Heading level={4}>Bottom anchor</Heading>
                  <Text variant="muted" size="sm">
                    Slides up from the bottom edge with a drag handle.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>right</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="right">
                <View className="flex-col gap-2">
                  <Heading level={4}>Right anchor</Heading>
                  <Text variant="muted" size="sm">
                    Slides in from the right edge. Desktop / wide-tablet shape; tight on phone.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
          </View>
        </View>
        <View>
          <Heading level={3}>Sizes</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            short ~33vh, medium ~60vh, tall ~95vh — applies to bottom anchor only.
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>short</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="short">
                <View className="flex-col gap-2">
                  <Heading level={4}>Short</Heading>
                  <Text variant="muted" size="sm">
                    ~33vh — flat lists of short labels.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>medium</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="medium">
                <View className="flex-col gap-2">
                  <Heading level={4}>Medium</Heading>
                  <Text variant="muted" size="sm">
                    ~60vh — grouped or rich-row lists.
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">
                  <Text>tall</Text>
                </Button>
              </SheetTrigger>
              <SheetContent anchor="bottom" size="tall">
                <View className="flex-col gap-2">
                  <Heading level={4}>Tall</Heading>
                  <Text variant="muted" size="sm">
                    ~95vh — rich detail (peek drawer, raw JSON viewer).
                  </Text>
                </View>
              </SheetContent>
            </Sheet>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
