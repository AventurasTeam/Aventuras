import { ScrollView, View } from 'react-native'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { Toaster } from '@/components/ui/toast'
import { toast } from '@/lib/toast'

export default function ToastDevRoute() {
  return (
    <View className="flex-1 bg-bg-base">
      <ScrollView contentContainerClassName="flex-grow">
        <ThemePicker />
        <View className="flex-col gap-6 p-4">
          <View>
            <Heading level={3}>Fire toasts</Heading>
            <Text variant="muted" size="xs" className="mt-1">
              Per-severity auto-dismiss durations: success 3s, info 5s, error 7s. Queue caps at 3 —
              fourth arrival accelerates the oldest.
            </Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              <Button variant="secondary" onPress={() => toast.success('Saved.')}>
                <Text>Success (3s)</Text>
              </Button>
              <Button
                variant="secondary"
                onPress={() => toast.info('Provider connected. Default model: gpt-4.')}
              >
                <Text>Info (5s)</Text>
              </Button>
              <Button variant="secondary" onPress={() => toast.error('Connection failed. Retry?')}>
                <Text>Error (7s)</Text>
              </Button>
            </View>
          </View>

          <View>
            <Heading level={3}>Queue stack</Heading>
            <Text variant="muted" size="xs" className="mt-1">
              Fires three toasts in sequence. Newest sits on top; bottom-most dismisses soonest.
            </Text>
            <View className="mt-3">
              <Button
                variant="secondary"
                onPress={() => {
                  toast.success('First — landed earliest, dismisses soonest.')
                  toast.info('Second — middle of the stack.')
                  toast.error('Third — newest, sits on top.')
                }}
              >
                <Text>Fill stack (3 toasts)</Text>
              </Button>
            </View>
          </View>

          <View>
            <Heading level={3}>Long copy</Heading>
            <View className="mt-3">
              <Button
                variant="secondary"
                onPress={() =>
                  toast.info(
                    'Provider connected. Default model: claude-opus-4. Change anytime in Settings. Multi-line copy wraps freely.',
                  )
                }
              >
                <Text>Multi-line info</Text>
              </Button>
            </View>
          </View>
        </View>
      </ScrollView>
      <Toaster />
    </View>
  )
}
