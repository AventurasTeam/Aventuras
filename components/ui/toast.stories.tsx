import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'

import { Button } from './button'
import { Text } from './text'
import { Toast, Toaster } from './toast'
import { toast } from '@/lib/toast'
import { toastStore, type ToastItem } from '@/lib/toast/store'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Toaster> = {
  title: 'Patterns/Toast',
  component: Toaster,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Toaster>

// Live store-backed Toaster — fire toasts via the imperative API.
export const Live: Story = {
  render: () => (
    <View className="min-h-screen items-center justify-center gap-3 p-6">
      <Text size="sm" variant="muted">
        Click a button to fire a toast. Queue caps at 3; oldest dismisses early when a fourth
        arrives.
      </Text>
      <View className="flex-row gap-2">
        <Button variant="secondary" onPress={() => toast.success('Saved.')}>
          <Text>Success</Text>
        </Button>
        <Button variant="secondary" onPress={() => toast.error('Connection failed. Retry?')}>
          <Text>Error</Text>
        </Button>
        <Button
          variant="secondary"
          onPress={() =>
            toast.info('Provider connected. Default model: gpt-4. Change anytime in Settings.')
          }
        >
          <Text>Info</Text>
        </Button>
      </View>
      <Toaster />
    </View>
  ),
}

// Static severity row — for visual / theme-matrix verification
// without the auto-dismiss timer firing.
function StaticToast({ severity, message }: { severity: ToastItem['severity']; message: string }) {
  // Stable item; toastStore not involved so auto-dismiss doesn't run
  // (the timer in <Toast/> still fires but has nothing to remove).
  return <Toast item={{ id: `static-${severity}`, severity, message }} />
}

export const SeverityRow: Story = {
  render: () => (
    <View className="gap-2 p-6" style={{ width: 480 }}>
      <StaticToast severity="success" message="Saved." />
      <StaticToast severity="error" message="Connection failed. Retry?" />
      <StaticToast
        severity="info"
        message="Provider connected. Default model: gpt-4. Change anytime in Settings."
      />
    </View>
  ),
}

export const MultiLine: Story = {
  render: () => (
    <View className="gap-2 p-6" style={{ width: 360 }}>
      <StaticToast
        severity="info"
        message="Lorem ipsum dolor sit amet, consectetur adipiscing elit. Wraps to multiple lines on narrow containers."
      />
    </View>
  ),
}

export const QueueStack: Story = {
  render: () => {
    React.useEffect(() => {
      toastStore.__reset()
      toast.success('First — landed earliest, dismisses soonest.')
      toast.info('Second — middle of the stack.')
      toast.error('Third — newest, sits on top.')
    }, [])
    return (
      <View className="min-h-screen p-6">
        <Text size="sm" variant="muted">
          Three toasts stacked, newest on top. Bottom-most dismisses soonest (auto-timer).
        </Text>
        <Toaster />
      </View>
    )
  },
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4 p-6">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-3"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <View className="gap-2">
            <StaticToast severity="success" message="Saved." />
            <StaticToast severity="error" message="Failed." />
            <StaticToast severity="info" message="Info message." />
          </View>
        </View>
      ))}
    </View>
  ),
}
