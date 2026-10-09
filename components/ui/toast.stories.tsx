import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect } from 'react'
import { View } from 'react-native'
import { expect, screen, waitFor } from 'storybook/test'

import { themes } from '@/lib/themes'
import { toast, toastStore, type ToastItem } from '@/lib/toast'

import { Button } from './button'
import { Text } from './text'
import { Toast, Toaster } from './toast'

const meta: Meta<typeof Toaster> = {
  title: 'Primitives/Toast',
  component: Toaster,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Toaster>

// Live store-backed Toaster — fire toasts via the imperative API.
// Needs fullscreen so the Toaster's top-anchored portal has a real
// viewport to render against.
export const Live: Story = {
  parameters: { layout: 'fullscreen' },
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
        <Button
          variant="secondary"
          onPress={() =>
            toast.warning('Translation: 3 rows missing.', {
              action: { label: 'Retry', onPress: () => toast.success('Retried.') },
            })
          }
        >
          <Text>Warning + action</Text>
        </Button>
      </View>
      <Toaster />
    </View>
  ),
}

// Mounting <Toaster/> and enqueueing renders the toast (role=status) — the
// queue → mount proof the 1.7a brief deferred here from a render assertion.
// Reset in beforeEach (before the Toaster subscribes); __reset clears listeners,
// so resetting inside play would orphan the live subscription.
export const RendersEnqueuedToast: Story = {
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    toastStore.__reset()
  },
  render: () => (
    <View className="min-h-screen p-6">
      <Toaster />
    </View>
  ),
  play: async () => {
    toast.success('Smoke toast rendered.')
    const status = await screen.findByRole('status')
    await expect(status).toHaveTextContent('Smoke toast rendered.')
  },
}

/** Runs `play` in a window wide enough for a band beside the toast; a no-op resize outside Vitest. */
async function withWideWindow(play: () => Promise<void>) {
  const browser = await import('vitest/browser').catch(() => null)
  const original = { width: window.innerWidth, height: window.innerHeight }
  await browser?.page.viewport(1000, original.height)
  try {
    await play()
  } finally {
    await browser?.page.viewport(original.width, original.height)
  }
}

const topmostAt = (box: DOMRect) =>
  document.elementFromPoint(
    Math.floor(box.left + box.width / 2),
    Math.floor(box.top + box.height / 2),
  )

// The full-width container spans the top strip; only the toast itself may take the click.
export const ClicksPassBesideToast: Story = {
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    toastStore.__reset()
  },
  render: () => (
    <View className="min-h-screen">
      <View className="absolute left-6 top-6">
        <Button variant="secondary">
          <Text>Beside</Text>
        </Button>
      </View>
      <Toaster />
    </View>
  ),
  play: () =>
    withWideWindow(async () => {
      toast.success('Covers the top strip.')
      const status = await screen.findByRole('status')
      const beside = screen.getByRole('button', { name: 'Beside' })
      const besideBox = beside.getBoundingClientRect()
      // Past the slide-in, so the toast sits in the strip it covers.
      await waitFor(() =>
        expect(status.getBoundingClientRect().bottom).toBeGreaterThan(besideBox.top),
      )
      const statusBox = status.getBoundingClientRect()
      await expect(besideBox.right).toBeLessThan(statusBox.left)

      const hit = topmostAt(besideBox)
      await expect(hit != null && beside.contains(hit)).toBe(true)
      const toastHit = topmostAt(statusBox)
      await expect(toastHit != null && status.contains(toastHit)).toBe(true)
    }),
}

// Static severity row — for visual / theme-matrix verification
// without the auto-dismiss timer firing.
function StaticToast({
  severity,
  message,
  action,
}: {
  severity: ToastItem['severity']
  message: string
  action?: ToastItem['action']
}) {
  // Stable item; toastStore not involved so auto-dismiss doesn't run
  // (the timer in <Toast/> still fires but has nothing to remove).
  return (
    <Toast item={{ id: `static-${severity}`, severity, message, ...(action ? { action } : {}) }} />
  )
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
      <StaticToast severity="warning" message="Translation: 3 rows missing." />
    </View>
  ),
}

export const WithAction: Story = {
  render: () => (
    <View className="gap-2 p-6" style={{ width: 400 }}>
      <StaticToast
        severity="warning"
        message="Translation: 3 rows missing."
        action={{ label: 'Retry', onPress: () => {} }}
      />
      <StaticToast
        severity="error"
        message="Save failed."
        action={{ label: 'Retry', onPress: () => {} }}
      />
      <StaticToast
        severity="info"
        message="Update available."
        action={{ label: 'Reload', onPress: () => {} }}
      />
      <StaticToast
        severity="success"
        message="Exported to file."
        action={{ label: 'Open', onPress: () => {} }}
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
  parameters: { layout: 'fullscreen' },
  render: () => {
    useEffect(() => {
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
            <StaticToast severity="warning" message="Warning message." />
          </View>
        </View>
      ))}
    </View>
  ),
}
