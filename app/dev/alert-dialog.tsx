import { ScrollView, View } from 'react-native'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export default function AlertDialogDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Basic — primary CTA</Heading>
          <View className="mt-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary">
                  <Text>Open dialog</Text>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Continue?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action will proceed. You can cancel out at any point.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button variant="secondary">
                      <Text>Cancel</Text>
                    </Button>
                  </AlertDialogCancel>
                  <AlertDialogAction asChild>
                    <Button variant="primary">
                      <Text>Continue</Text>
                    </Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </View>
        </View>

        <View>
          <Heading level={3}>Rollback — destructive + bulleted impact</Heading>
          <View className="mt-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary">
                  <Text>Trigger rollback</Text>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete from entry 47?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Permanent — rolls back to entry 46.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <View className="gap-1">
                  <Text size="sm">• 12 entries</Text>
                  <Text size="sm">• 4 classifications</Text>
                  <Text size="sm">• 23 world-state changes</Text>
                </View>
                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button variant="secondary">
                      <Text>Cancel</Text>
                    </Button>
                  </AlertDialogCancel>
                  <AlertDialogAction asChild>
                    <Button variant="destructive">
                      <Text>Delete entries</Text>
                    </Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </View>
        </View>

        <View>
          <Heading level={3}>Calendar swap — structured sub-warnings</Heading>
          <View className="mt-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary">
                  <Text>Switch calendar</Text>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Switch calendar to Stardate?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Three changes will apply on switch. Review each.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <View className="gap-3">
                  <View className="bg-bg-region gap-1 rounded-md border border-warning p-3">
                    <Text size="sm" className="font-medium">
                      Origin tuple — Stardate&apos;s tier set differs.
                    </Text>
                    <Text size="xs" variant="muted">
                      You&apos;ll need to re-pick the story-start moment.
                    </Text>
                  </View>
                  <View className="bg-bg-region gap-1 rounded-md border border-warning p-3">
                    <Text size="sm" className="font-medium">
                      Era support mismatch.
                    </Text>
                    <Text size="xs" variant="muted">
                      4 era flips on this branch reference an era Stardate doesn&apos;t define.
                    </Text>
                  </View>
                  <View className="bg-bg-region gap-1 rounded-md border border-info p-3">
                    <Text size="sm" className="font-medium">
                      Display format change.
                    </Text>
                    <Text size="xs" variant="muted">
                      Existing: Year 1247, day 88 → Stardate 47634.4
                    </Text>
                  </View>
                </View>
                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button variant="secondary">
                      <Text>Cancel</Text>
                    </Button>
                  </AlertDialogCancel>
                  <AlertDialogAction asChild>
                    <Button variant="primary">
                      <Text>Switch calendar</Text>
                    </Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
