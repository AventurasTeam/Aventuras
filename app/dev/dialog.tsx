import { ScrollView, View } from 'react-native'

import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export default function DialogDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Default scroll host — overflowing body</Heading>
          <View className="mt-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">
                  <Text>Open overflowing dialog</Text>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Long dialog</DialogTitle>
                  <DialogDescription>More rows than fit on screen.</DialogDescription>
                </DialogHeader>
                {Array.from({ length: 40 }, (_, i) => (
                  <Text key={i} size="sm">{`Row ${i + 1}`}</Text>
                ))}
                <DialogFooter>
                  <Button variant="primary">
                    <Text>Confirm</Text>
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </View>
        </View>

        <View>
          <Heading level={3}>Host-owned scroll — `scrollable={false}`</Heading>
          <View className="mt-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">
                  <Text>Open host-scrolled dialog</Text>
                </Button>
              </DialogTrigger>
              <DialogContent scrollable={false}>
                <DialogHeader>
                  <DialogTitle>Form-owned scroll</DialogTitle>
                </DialogHeader>
                <ScrollView className="shrink" contentContainerClassName="gap-1">
                  {Array.from({ length: 40 }, (_, i) => (
                    <Text key={i} size="sm">{`Row ${i + 1}`}</Text>
                  ))}
                </ScrollView>
                <DialogFooter>
                  <Button variant="primary">
                    <Text>Confirm</Text>
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
